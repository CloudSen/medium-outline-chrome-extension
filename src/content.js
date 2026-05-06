(function mediumOutlineExtension() {
  const ROOT_ID = "medium-outline-extension-root";
  const HEADING_SELECTOR = "h1, h2, h3, h4";
  const MIN_HEADINGS = 2;
  const REBUILD_DELAY_MS = 250;
  const ACTIVE_ROOT_MARGIN = "-18% 0px -68% 0px";
  const DEFAULT_LEFT_OFFSET = 16;
  const LEFT_RAIL_GAP = 16;
  const LEFT_RAIL_MAX_RIGHT = 420;
  const LEFT_RAIL_MIN_WIDTH = 80;
  const LEFT_RAIL_MAX_WIDTH = 360;
  const MEDIUM_LEFT_RAIL_RIGHT = 240;
  const MEDIUM_SIDEBAR_LINK_SELECTOR = [
    'a[href*="source=post_page---sidebar_menu"]',
    'a[href*="source=post_page---sidebar_menu_following"]',
  ].join(",");
  const MEDIUM_PAGE_SIGNAL_SELECTOR = [
    'a[href*="medium.com/?source=post_page"]',
    'a[href*="medium.com/new-story?source=post_page"]',
    'a[href*="source=post_page---sidebar_menu"]',
    'script[src*="cdn-client.medium.com"]',
    'script[src*="medium.com/_/"]',
  ].join(",");
  const MEDIUM_STORY_ID_IN_PATH_PATTERN = /(?:^|[-/])[\da-f]{12}(?:$|\/)/i;
  const NON_ARTICLE_MEDIUM_PATH_PATTERNS = [
    /^\/?$/,
    /^\/about(?:\/|$)/,
    /^\/explore(?:\/|$)/,
    /^\/lists(?:\/|$)/,
    /^\/m(?:\/|$)/,
    /^\/me(?:\/|$)/,
    /^\/membership(?:\/|$)/,
    /^\/new-story(?:\/|$)/,
    /^\/search(?:\/|$)/,
    /^\/tag(?:\/|$)/,
    /^\/topic(?:\/|$)/,
  ];
  const ARTICLE_BOUNDARY_HEADING_PATTERNS = [
    /^Responses\s*(\(\d+\))?$/i,
    /^More from\b/i,
    /^Recommended from Medium$/i,
  ];

  let root = null;
  let sidebar = null;
  let list = null;
  let empty = null;
  let collapseButton = null;
  let activeHeadingId = null;
  let rebuildTimer = 0;
  let observer = null;
  let intersectionObserver = null;
  let headings = [];

  function debounceRebuild() {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(rebuild, REBUILD_DELAY_MS);
  }

  function isMediumHostname() {
    return location.hostname === "medium.com" || location.hostname.endsWith(".medium.com");
  }

  function isMediumPoweredPage() {
    return isMediumHostname() || Boolean(document.querySelector(MEDIUM_PAGE_SIGNAL_SELECTOR));
  }

  function hasLikelyMediumStoryPath() {
    const path = location.pathname;

    if (NON_ARTICLE_MEDIUM_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
      return false;
    }

    return MEDIUM_STORY_ID_IN_PATH_PATTERN.test(path);
  }

  function isMediumPoweredArticlePage() {
    const hasArticleTitle = Boolean(findPrimaryArticle());

    return hasArticleTitle && hasLikelyMediumStoryPath() && isMediumPoweredPage();
  }

  function createRoot() {
    const existingRoot = document.getElementById(ROOT_ID);
    if (existingRoot) {
      existingRoot.remove();
    }

    root = document.createElement("div");
    root.id = ROOT_ID;

    sidebar = document.createElement("aside");
    sidebar.className = "moe-sidebar";
    sidebar.setAttribute("aria-label", "Article outline");

    const header = document.createElement("div");
    header.className = "moe-header";

    const title = document.createElement("div");
    title.className = "moe-title";
    title.textContent = "Outline";

    collapseButton = document.createElement("button");
    collapseButton.className = "moe-collapse";
    collapseButton.type = "button";
    collapseButton.setAttribute("aria-label", "Collapse outline");
    collapseButton.title = "Collapse outline";
    collapseButton.textContent = "<";
    collapseButton.addEventListener("click", toggleCollapsed);

    header.append(title, collapseButton);

    empty = document.createElement("div");
    empty.className = "moe-empty";
    empty.textContent = "No outline";

    list = document.createElement("nav");
    list.className = "moe-list";
    list.setAttribute("aria-label", "Article headings");

    sidebar.append(header, empty, list);
    root.append(sidebar);
    document.documentElement.append(root);
  }

  function destroyRoot() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }

    const existingRoot = document.getElementById(ROOT_ID);
    if (existingRoot) {
      existingRoot.remove();
    }

    root = null;
    sidebar = null;
    list = null;
    empty = null;
    collapseButton = null;
    activeHeadingId = null;
    headings = [];
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function findLeftRailRightEdge() {
    if (!document.body) {
      return 0;
    }

    const candidates = Array.from(document.body.querySelectorAll("aside, nav, div"));
    const viewportHeight = window.innerHeight;
    let rightEdge = 0;

    candidates.forEach((candidate) => {
      if (candidate.closest(`#${ROOT_ID}`) || !isVisible(candidate)) {
        return;
      }

      const rect = candidate.getBoundingClientRect();
      const startsAtLeftEdge = rect.left <= 8 && rect.right > LEFT_RAIL_MIN_WIDTH;
      const hasRailWidth =
        rect.width >= LEFT_RAIL_MIN_WIDTH &&
        rect.width <= LEFT_RAIL_MAX_WIDTH &&
        rect.right <= LEFT_RAIL_MAX_RIGHT;
      const spansViewport =
        rect.height >= viewportHeight * 0.6 ||
        (rect.top <= 120 && rect.bottom >= viewportHeight * 0.65);

      if (startsAtLeftEdge && hasRailWidth && spansViewport) {
        rightEdge = Math.max(rightEdge, rect.right);
      }
    });

    return Math.round(rightEdge);
  }

  function findMediumSidebarRightEdge() {
    const links = Array.from(document.querySelectorAll(MEDIUM_SIDEBAR_LINK_SELECTOR));
    let rightEdge = 0;
    let hasVisibleSidebarLink = false;

    links.forEach((link) => {
      if (!isVisible(link)) {
        return;
      }

      const linkRect = link.getBoundingClientRect();
      const isLeftNavigationLink =
        linkRect.width > 0 &&
        linkRect.height > 0 &&
        linkRect.left >= 0 &&
        linkRect.left <= LEFT_RAIL_MAX_RIGHT &&
        linkRect.top >= 80;

      if (!isLeftNavigationLink) {
        return;
      }

      hasVisibleSidebarLink = true;
      rightEdge = Math.max(rightEdge, linkRect.right + LEFT_RAIL_GAP);

      let ancestor = link.parentElement;
      while (ancestor && ancestor !== document.body) {
        const ancestorRect = ancestor.getBoundingClientRect();
        const isRailLikeAncestor =
          ancestorRect.left <= 24 &&
          ancestorRect.right > rightEdge &&
          ancestorRect.right <= LEFT_RAIL_MAX_RIGHT &&
          ancestorRect.height >= 40;

        if (isRailLikeAncestor) {
          rightEdge = ancestorRect.right;
        }

        ancestor = ancestor.parentElement;
      }
    });

    if (hasVisibleSidebarLink) {
      rightEdge = Math.max(rightEdge, MEDIUM_LEFT_RAIL_RIGHT);
    }

    return Math.round(rightEdge);
  }

  function updateSidebarPosition() {
    if (!root) {
      return;
    }

    const leftRailRightEdge = Math.max(findLeftRailRightEdge(), findMediumSidebarRightEdge());
    const leftOffset = leftRailRightEdge
      ? leftRailRightEdge + LEFT_RAIL_GAP
      : DEFAULT_LEFT_OFFSET;

    root.style.setProperty("--moe-left-offset", `${leftOffset}px`);
  }

  function toggleCollapsed() {
    const collapsed = sidebar.classList.toggle("moe-sidebar--collapsed");
    collapseButton.setAttribute(
      "aria-label",
      collapsed ? "Expand outline" : "Collapse outline",
    );
    collapseButton.title = collapsed ? "Expand outline" : "Collapse outline";
    collapseButton.textContent = collapsed ? ">" : "<";
  }

  function getHeadingLevel(heading) {
    return Number.parseInt(heading.tagName.slice(1), 10);
  }

  function isArticleHeadingCandidate(heading) {
    return (
      !heading.closest(`#${ROOT_ID}`) &&
      heading.textContent.trim().length > 0 &&
      heading.offsetParent !== null
    );
  }

  function normalizeHeadingText(heading) {
    return heading.textContent.trim().replace(/\s+/g, " ");
  }

  function isArticleBoundaryHeading(heading) {
    const text = normalizeHeadingText(heading);
    return ARTICLE_BOUNDARY_HEADING_PATTERNS.some((pattern) => pattern.test(text));
  }

  function findPrimaryArticle() {
    const visibleArticleHeadings = Array.from(document.querySelectorAll("article h1"))
      .filter(isArticleHeadingCandidate)
      .sort(
        (a, b) =>
          a.getBoundingClientRect().top -
          b.getBoundingClientRect().top,
      );

    for (const heading of visibleArticleHeadings) {
      const article = heading.closest("article");
      if (article) {
        return article;
      }
    }

    return null;
  }

  function getVisibleArticleHeadings() {
    const article = findPrimaryArticle();
    if (!article) {
      return [];
    }

    const scanRoot = article;
    const nextHeadings = [];

    for (const heading of Array.from(scanRoot.querySelectorAll(HEADING_SELECTOR))) {
      if (!isArticleHeadingCandidate(heading)) {
        continue;
      }

      if (heading.closest("article") !== article) {
        continue;
      }

      if (nextHeadings.length > 0 && isArticleBoundaryHeading(heading)) {
        break;
      }

      nextHeadings.push(heading);
    }

    return nextHeadings
      .filter((heading) => heading.textContent.trim().length > 0)
      .filter((heading) => heading.offsetParent !== null);
  }

  function ensureHeadingId(heading, index) {
    const existing = heading.getAttribute("data-medium-outline-id");
    if (existing) {
      return existing;
    }

    const id = `medium-outline-heading-${Date.now()}-${index}`;
    heading.setAttribute("data-medium-outline-id", id);
    return id;
  }

  function clearList() {
    list.replaceChildren();
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }
  }

  function renderOutline(nextHeadings) {
    clearList();

    const shouldShow = nextHeadings.length >= MIN_HEADINGS;
    sidebar.classList.toggle("moe-sidebar--hidden", !shouldShow);
    empty.hidden = shouldShow;
    list.hidden = !shouldShow;

    if (!shouldShow) {
      return;
    }

    const minLevel = Math.min(...nextHeadings.map((heading) => getHeadingLevel(heading)));
    const fragment = document.createDocumentFragment();

    nextHeadings.forEach((heading, index) => {
      const id = ensureHeadingId(heading, index);
      const level = Math.min(getHeadingLevel(heading) - minLevel, 3);

      const link = document.createElement("a");
      link.className = "moe-link";
      link.href = "#";
      link.dataset.headingId = id;
      link.dataset.level = String(level);
      link.textContent = heading.textContent.trim();
      link.addEventListener("click", (event) => {
        event.preventDefault();
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveHeading(id);
      });

      fragment.append(link);
    });

    list.append(fragment);
  }

  function setActiveHeading(id) {
    activeHeadingId = id;

    Array.from(list.querySelectorAll(".moe-link")).forEach((link) => {
      const isActive = link.dataset.headingId === activeHeadingId;
      link.classList.toggle("moe-link--active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function observeActiveHeading() {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
    }

    intersectionObserver = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visibleEntries[0]) {
          setActiveHeading(visibleEntries[0].target.getAttribute("data-medium-outline-id"));
        }
      },
      {
        root: null,
        rootMargin: ACTIVE_ROOT_MARGIN,
        threshold: [0, 1],
      },
    );

    headings.forEach((heading) => intersectionObserver.observe(heading));
  }

  function signatureFor(nextHeadings) {
    return nextHeadings
      .map((heading) => `${heading.tagName}:${heading.textContent.trim()}`)
      .join("|");
  }

  function rebuild() {
    if (!document.body) {
      return;
    }

    if (!isMediumPoweredArticlePage()) {
      destroyRoot();
      return;
    }

    if (!root) {
      createRoot();
    }

    updateSidebarPosition();

    const nextHeadings = getVisibleArticleHeadings();
    const oldSignature = signatureFor(headings);
    const nextSignature = signatureFor(nextHeadings);
    const sameHeadingNodes =
      headings.length === nextHeadings.length &&
      headings.every((heading, index) => heading === nextHeadings[index]);

    if (sameHeadingNodes && oldSignature === nextSignature) {
      return;
    }

    headings = nextHeadings;
    renderOutline(headings);

    if (headings.length >= MIN_HEADINGS) {
      observeActiveHeading();
      setActiveHeading(headings[0].getAttribute("data-medium-outline-id"));
    }
  }

  function observePageChanges() {
    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver((mutations) => {
      const shouldRebuild = mutations.some((mutation) => {
        const target = mutation.target;
        if (!(target instanceof Element)) {
          return false;
        }

        return !target.closest(`#${ROOT_ID}`);
      });

      if (shouldRebuild) {
        debounceRebuild();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function init() {
    if (!isMediumPoweredPage()) {
      return;
    }

    rebuild();
    observePageChanges();
    window.addEventListener("popstate", debounceRebuild);
    window.addEventListener("hashchange", debounceRebuild);
    window.addEventListener("resize", debounceRebuild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

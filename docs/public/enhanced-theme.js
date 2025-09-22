// Enhanced theme initialization with redirect handling
(function() {
  "use strict";
  
  // Apply theme immediately to prevent flashing
  function applyTheme() {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
    const storedTheme = localStorage.getItem("vocs.theme");
    const theme = storedTheme || (prefersDark.matches ? "dark" : "light");
    
    // Remove existing theme classes
    document.documentElement.classList.remove("dark", "light");
    
    // Apply theme
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.add("light");
    }
  }
  
  // Apply theme immediately
  applyTheme();
  
  // Handle system theme changes
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  if (!localStorage.getItem("vocs.theme")) {
    prefersDark.addEventListener("change", ({ matches }) => {
      if (matches) {
        document.documentElement.classList.add("dark");
        document.documentElement.classList.remove("light");
      } else {
        document.documentElement.classList.add("light");
        document.documentElement.classList.remove("dark");
      }
    });
  }
  
  // Handle redirects after theme is applied
  function handleRedirects() {
    const path = window.location.pathname;
    
    // Define redirect mappings
    const redirects = {
      '/intro/': '/intro/introduction',
      '/contribute/': '/contribute/contributing',
      '/intro': '/intro/introduction',
      '/contribute': '/contribute/contributing'
    };
    
    // Check for section redirects (/:section -> /:section/overview)
    const sectionMatch = path.match(/^\/([^\/]+)\/?$/);
    if (sectionMatch && !redirects[path]) {
      const section = sectionMatch[1];
      // Skip known non-section paths
      const skipPaths = ['api', 'assets', 'logo', 'favicon.ico'];
      if (!skipPaths.includes(section)) {
        redirects[path] = `/${section}/overview`;
      }
    }
    
    // Apply redirect if found
    if (redirects[path]) {
      // Use replaceState to avoid adding to history
      window.history.replaceState(null, '', redirects[path]);
      // Reload to get the new page content
      window.location.reload();
    }
  }
  
  // Handle redirects after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', handleRedirects);
  } else {
    handleRedirects();
  }
})();

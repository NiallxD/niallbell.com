export default {
  layout: (data) => {
    if (!data.page?.inputPath?.endsWith(".md")) return data.layout;
    if (data.Type === "Gallery") return "gallery.njk";
    if (data.Type === "Video") return "video.njk";
    if (data.Type === "Map") return "map.njk";
    if (data.Type === "ECard") return "ecard.njk";
    if (["Blog Post", "Photo Story", "Photo Analysis"].includes(data.Type)) return "post.njk";
    if (data.Type === "Project") return "project.njk";
    return data.layout || "standard.njk";
  },

  permalink: (data) => {
    // Let JS templates honour their own data() permalink
    if (data.page?.inputPath?.endsWith(".11ty.js")) return data.permalink;
    if (!data.page?.inputPath?.endsWith(".md")) return undefined;
    const publish = String(data.publish).trim().toLowerCase() === "true";
    if (!publish) return false;
    // Project cards with a `url` link out instead of building a page.
    // Project cards without an explicit permalink don't get a page either.
    if (data.Type === "Project" && (data.url || !data.permalink)) return false;
    if (data.permalink) {
      if (data.permalink.endsWith(".html")) return data.permalink;
      const p = data.permalink.replace(/\/$/, "");
      return p + "/index.html";
    }
    return undefined;
  },

  eleventyExcludeFromCollections: (data) => {
    if (!data.page?.inputPath?.endsWith(".md")) return false;
    const publish = String(data.publish).trim().toLowerCase() === "true";
    return !publish;
  },

  // Ensure we have a coverImage property from any of the standard sources
  coverImage: (data) => data.coverImage || data["header-image"] || data.heroImage || null,
};

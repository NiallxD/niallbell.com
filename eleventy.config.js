import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import markdownIt from "markdown-it";

function buildWikilinkMap(rootDir) {
  const map = new Map();
  const skip = new Set(["node_modules", "_site", ".obsidian", ".git", "96 - Hidden Notes", "99 - Not For Publish", "98 - Media", "97 - Drafts"]);
  function walk(dir) {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        try {
          if (statSync(full).isDirectory()) {
            if (!skip.has(entry)) walk(full);
          } else if (extname(entry) === ".md") {
            const raw = readFileSync(full, "utf8");
            const fm = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
            if (!/^publish:\s*true/m.test(fm)) continue;
            const permalink = fm.match(/^permalink:\s*(.+)$/m)?.[1]?.trim();
            const title = fm.match(/^title:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
            if (!permalink) continue;
            const url = (permalink.startsWith("/") ? permalink : "/" + permalink).replace(/\/?$/, "/");
            if (title) map.set(title.toLowerCase(), url);
            map.set(entry.replace(/\.md$/, "").toLowerCase(), url);
          }
        } catch {}
      }
    } catch {}
  }
  walk(rootDir);
  return map;
}

function wikilinkPlugin(md, wikilinkMap) {
  md.core.ruler.push("wikilinks", (state) => {
    for (const block of state.tokens) {
      if (block.type !== "inline" || !block.children) continue;
      const out = [];
      for (const tok of block.children) {
        if (tok.type !== "text" || !tok.content.includes("[[")) {
          out.push(tok);
          continue;
        }
        const re = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
        let last = 0, m;
        let matched = false;
        while ((m = re.exec(tok.content)) !== null) {
          matched = true;
          if (m.index > last) {
            const t = new state.Token("text", "", 0);
            t.content = tok.content.slice(last, m.index);
            out.push(t);
          }
          const [, page, display] = m;
          const label = (display || page).trim();
          const href = wikilinkMap.get(page.trim().toLowerCase()) ?? wikilinkMap.get((display || page).trim().toLowerCase());
          if (href) {
            const o = new state.Token("link_open", "a", 1);
            o.attrs = [["href", href], ["class", "wikilink"]];
            out.push(o);
            const t = new state.Token("text", "", 0);
            t.content = label;
            out.push(t);
            out.push(new state.Token("link_close", "a", -1));
          } else {
            const t = new state.Token("html_inline", "", 0);
            t.content = `<span class="wikilink">${label}</span>`;
            out.push(t);
          }
          last = m.index + m[0].length;
        }
        if (matched && last < tok.content.length) {
          const t = new state.Token("text", "", 0);
          t.content = tok.content.slice(last);
          out.push(t);
        } else if (!matched) {
          out.push(tok);
        }
      }
      block.children = out;
    }
  });
}

function parseSlidesFromBlock(blockHtml) {
  const slides = [];
  if (!blockHtml.trim()) return slides;
  const blocks = blockHtml.split(/(?=<h2)/i);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (!titleMatch) continue;
    let rawTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim()
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    if (!rawTitle || /gallery-(start|end)/i.test(rawTitle)) continue;
    let nativeAspect = false;
    if (/\[AR\]/i.test(rawTitle)) {
      nativeAspect = true;
      rawTitle = rawTitle.replace(/\[AR\]/i, '').trim();
    }
    const blockTitle = rawTitle;
    const contentWithoutTitle = block.replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '');
    const imgRegex = /<img[^>]+src="([^"]+)"/gi;
    const imgsFound = [];
    let igm;
    while ((igm = imgRegex.exec(contentWithoutTitle)) !== null) imgsFound.push(igm[1]);
    const urlRegex = /((?:https?:\/\/|\/)[^\s<"']+\.(?:jpg|jpeg|png|gif|webp|avif|JPG|JPEG|PNG|GIF|WEBP|AVIF))/gi;
    const rawUrls = [];
    let um;
    while ((um = urlRegex.exec(contentWithoutTitle)) !== null) {
      if (!imgsFound.includes(um[1])) rawUrls.push(um[1]);
    }
    const uniqueRawUrls = [...new Set(rawUrls)];
    let pureCaption = contentWithoutTitle
      .replace(/<img[^>]+>/gi, '')
      .replace(/<a[^>]+>https?:\/\/[^<]+<\/a>/gi, '')
      .replace(/https?:\/\/[^\s<"']+\.(?:jpg|jpeg|png|gif|webp|avif|JPG|JPEG|PNG|GIF|WEBP|AVIF)/gi, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/<p>\s*<\/p>/gi, '')
      .trim();
    const srcList = imgsFound.length > 0 ? imgsFound : uniqueRawUrls;
    srcList.forEach((src, idx) => {
      slides.push({ type: 'image', src, title: blockTitle, nativeAspect, caption: idx === 0 ? pureCaption : '' });
    });
  }
  return slides;
}

function buildInlineGallery(uid, slides) {
  const swiperId = `post-swiper-${uid}`;
  const paginationId = `post-pagination-${uid}`;
  const captionAreaId = `post-caption-${uid}`;
  const titleId = `post-slide-title-${uid}`;
  const descId = `post-slide-desc-${uid}`;
  const dataVar = `postGalleryData${uid}`;
  const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const desktopSlides = slides.map(img => {
    const onload = img.nativeAspect
      ? `onload="this.classList.add('is-native-ar')"`
      : `onload="this.classList.add(this.naturalWidth>this.naturalHeight?'is-landscape':'is-portrait')"`;
    return `<div class="swiper-slide"><div class="slide-inner"><img src="${esc(img.src)}" alt="${esc(img.title)}" loading="lazy" ${onload}></div></div>`;
  }).join('');
  const mobileItems = slides.map(img => {
    const hasContent = img.title || img.caption;
    return `<div class="mobile-grid-item"><div class="mobile-grid-media"><img src="${esc(img.src)}" alt="${esc(img.title)}" loading="lazy"></div>${hasContent ? `<div class="mobile-grid-content">${img.title ? `<h4 class="mobile-grid-title">${img.title}</h4>` : ''}${img.caption ? `<div class="mobile-grid-caption">${img.caption}</div>` : ''}</div>` : ''}</div>`;
  }).join('');
  const slidesJson = JSON.stringify(slides).replace(/<\/script>/gi, '<\\/script>');
  return `<div class="gallery-body" style="margin-top:2rem;margin-bottom:2rem;"><div class="gallery-slideshow-container no-bg desktop-only"><div class="swiper gallery-swiper" id="${swiperId}"><div class="swiper-wrapper">${desktopSlides}</div><div class="swiper-button-prev"></div><div class="swiper-button-next"></div></div><div class="gallery-pagination swiper-pagination" id="${paginationId}"></div><div id="${captionAreaId}" class="gallery-caption-external" style="display:none;"><h3 id="${titleId}"></h3><p id="${descId}"></p></div></div><div class="gallery-mobile-grid mobile-only">${mobileItems}</div><script>(function(){var ${dataVar}=${slidesJson};document.addEventListener('DOMContentLoaded',function(){var tEl=document.getElementById('${titleId}');var dEl=document.getElementById('${descId}');var cArea=document.getElementById('${captionAreaId}');function upd(i){var d=${dataVar}[i];if(!d)return;tEl.textContent=d.title||'';dEl.innerHTML=d.caption||'';cArea.style.display=(d.title||d.caption)?'block':'none';}new Swiper('#${swiperId}',{loop:true,keyboard:{enabled:true},speed:600,pagination:{el:'#${paginationId}',type:'fraction',renderFraction:function(c,t){return'<span class="'+c+'"></span> <span class="fraction-sep">of</span> <span class="'+t+'"></span>';}},navigation:{nextEl:'#${swiperId} .swiper-button-next',prevEl:'#${swiperId} .swiper-button-prev'},on:{init:function(){upd(this.realIndex);},slideChange:function(){upd(this.realIndex);}}});});}());</script></div>`;
}

function parseTestimonialsFromBlock(blockHtml) {
  const testimonials = [];
  const blocks = blockHtml.split(/(?=<h2)/i);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (!titleMatch) continue;
    const rawTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    if (!rawTitle || /testimonials-(start|end)/i.test(rawTitle)) continue;

    const content = block.replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '');

    const subheadMatch = content.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const subhead = subheadMatch ? subheadMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const dateMatch = content.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
    const date = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    let remaining = content
      .replace(/<h3[^>]*>[\s\S]*?<\/h3>/gi, '')
      .replace(/<h4[^>]*>[\s\S]*?<\/h4>/gi, '');

    const nameMatch = remaining.match(/<p>\s*-([^<]+)<\/p>/i);
    const name = nameMatch ? nameMatch[1].trim() : '';

    const body = remaining
      .replace(/<p>\s*-[^<]+<\/p>/i, '')
      .replace(/<p>\s*<\/p>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .trim();

    const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    testimonials.push({ title: decode(rawTitle), subhead: decode(subhead), date: decode(date), body, name: decode(name) });
  }
  return testimonials;
}

function buildTestimonialsSlider(testimonials) {
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cards = testimonials.map(t => `<div class="exp-testimonial-card">
      <div class="exp-testimonial-header">
        <h4 class="exp-testimonial-title">${esc(t.title)}</h4>
        ${t.date ? `<span class="exp-testimonial-date">${esc(t.date)}</span>` : ''}
      </div>
      ${t.subhead ? `<p class="exp-testimonial-subhead">${esc(t.subhead)}</p>` : ''}
      ${t.body ? `<p class="exp-testimonial-body">${esc(t.body)}</p>` : ''}
      ${t.name ? `<p class="exp-testimonial-name">${esc(t.name)}</p>` : ''}
    </div>`).join('\n');
  return `<p class="section-label" style="margin-top:3rem;">What People Say</p>
<div class="exp-testimonials" id="exp-testimonials">
  <div class="exp-testimonial-track">
    ${cards}
  </div>
</div>`;
}

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("static");
  eleventyConfig.addPassthroughCopy("robots.txt");

  eleventyConfig.addGlobalData("galleryAudioTracks", () => {
    const dir = join("static", "audio");
    const exts = new Set([".mp3", ".ogg", ".wav", ".m4a", ".flac"]);
    try {
      return readdirSync(dir)
        .filter(f => exts.has(extname(f).toLowerCase()))
        .map(f => `/static/audio/${f}`);
    } catch { return []; }
  });

  // Markdown-it with HTML enabled + wikilinks
  const wikilinkMap = buildWikilinkMap(".");
  const md = markdownIt({ html: true, linkify: true, typographer: true });
  wikilinkPlugin(md, wikilinkMap);
  eleventyConfig.setLibrary("md", md);

  // Strip Obsidian artifacts from rendered post content
  eleventyConfig.addTransform("stripObsidianArtifacts", (content, outputPath) => {
    if (typeof outputPath !== "string" || !outputPath.endsWith(".html")) return content;
    // Remove hashtag-only paragraphs (#nature #wildlife etc.)
    content = content.replace(/<p>(\s*#[\w-]+)+\s*<\/p>/g, "");
    // Remove reading-time paragraph (Obsidian plugin, JS never runs)
    content = content.replace(/<p[^>]*id="reading-time"[^>]*>[\s\S]*?<\/p>/g, "");
    // Remove first <h1> inside .post-content (duplicate of frontmatter title in header)
    content = content.replace(
      /(<div class="post-content">)\s*<h1>[\s\S]*?<\/h1>/,
      "$1"
    );
    return content;
  });

  // Transform Obsidian callouts into styled divs
  eleventyConfig.addTransform("callouts", (content, outputPath) => {
    if (typeof outputPath !== "string" || !outputPath.endsWith(".html")) return content;
    return content.replace(
      /<blockquote>\s*<p>\[!([\w-]+)\]([^<\n]*)([\s\S]*?)<\/blockquote>/g,
      (_, type, titleRaw, bodyRaw) => {
        const t = type.toLowerCase();
        const title = titleRaw.trim() || type;
        let body = bodyRaw;
        if (body.startsWith("\n")) {
          body = body.replace(/^\n/, "").replace(/<\/p>\s*$/, "").trim();
          body = body ? `<p>${body}</p>` : "";
        } else {
          body = body.replace(/^<\/p>\s*/, "").trim();
        }
        return `<div class="callout callout-${t}"><div class="callout-title">${title}</div><div class="callout-body">${body}</div></div>`;
      }
    );
  });

  eleventyConfig.addTransform("inlineGalleries", (content, outputPath) => {
    if (typeof outputPath !== "string" || !outputPath.endsWith(".html")) return content;
    if (!content.includes("gallery-start")) return content;
    let uid = 0;
    return content.replace(
      /<h2[^>]*>\s*gallery-start\s*<\/h2>([\s\S]*?)<h2[^>]*>\s*gallery-end\s*<\/h2>/gi,
      (_, inner) => {
        const slides = parseSlidesFromBlock(inner);
        if (!slides.length) return '';
        return buildInlineGallery(uid++, slides);
      }
    );
  });

  eleventyConfig.addTransform("inlineTestimonials", (content, outputPath) => {
    if (typeof outputPath !== "string" || !outputPath.endsWith(".html")) return content;
    if (!content.includes("testimonials-start")) return content;
    return content.replace(
      /<h2[^>]*>\s*testimonials-start\s*<\/h2>([\s\S]*?)<h2[^>]*>\s*testimonials-end\s*<\/h2>/gi,
      (_, inner) => {
        const testimonials = parseTestimonialsFromBlock(inner);
        if (!testimonials.length) return '';
        return buildTestimonialsSlider(testimonials);
      }
    );
  });

  eleventyConfig.addFilter("markdown", (content) => {
    if (!content) return "";
    return md.render(content);
  });

  eleventyConfig.addFilter("limit", (arr, n) => (arr || []).slice(0, n));

  eleventyConfig.addFilter("ensureArray", (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return String(val).split(',').map(s => s.trim()).filter(Boolean);
  });

  eleventyConfig.addFilter("stripGalleryBlocks", (html) => {
    if (!html) return "";
    return html.replace(/<h2[^>]*>\s*gallery-start\s*<\/h2>[\s\S]*?<h2[^>]*>\s*gallery-end\s*<\/h2>/gi, "").replace(/^\s*[\r\n]/gm, '');
  });

  eleventyConfig.addFilter("year", () => new Date().getFullYear());

  eleventyConfig.addFilter("getAllTags", (collection) => {
    const tags = new Set();
    (collection || []).forEach(item => {
      (item.data.tags || []).forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  });

  eleventyConfig.addFilter("readableDate", (dateObj) => {
    if (!dateObj) return "";
    const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  });

  eleventyConfig.addFilter("isoDate", (dateObj) => {
    if (!dateObj) return "";
    const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
    return d.toISOString().split("T")[0];
  });

  eleventyConfig.addCollection("posts", (api) =>
    api.getAll()
      .filter((i) => {
        const publish = String(i.data.publish).trim().toLowerCase() === "true";
        const type = String(i.data.Type || "").trim().toLowerCase() === "blog post";
        return publish && type;
      })
      .sort((a, b) => (b.date || 0) - (a.date || 0))
  );

  eleventyConfig.addCollection("featuredPosts", (api) =>
    api.getAll()
      .filter((i) => {
        const publish = String(i.data.publish).trim().toLowerCase() === "true";
        const type = String(i.data.Type || "").trim().toLowerCase() === "blog post";
        return publish && type && i.data.featured === true;
      })
      .sort((a, b) => (b.date || 0) - (a.date || 0))
  );

  eleventyConfig.addCollection("regularPosts", (api) =>
    api.getAll()
      .filter((i) => {
        const publish = String(i.data.publish).trim().toLowerCase() === "true";
        const type = String(i.data.Type || "").trim().toLowerCase() === "blog post";
        return publish && type && i.data.featured !== true;
      })
      .sort((a, b) => (b.date || 0) - (a.date || 0))
  );

  eleventyConfig.addCollection("projects", (api) =>
    api.getAll()
      .filter((i) => String(i.data.publish).trim().toLowerCase() === "true" && i.data.Type === "Project")
      .sort((a, b) => (a.data.order || 0) - (b.data.order || 0))
  );

  eleventyConfig.addCollection("galleries", (api) =>
    api.getAll()
      .filter((i) => String(i.data.publish).trim().toLowerCase() === "true" && i.data.Type === "Gallery" && !i.data["home-gallery"])
      .sort((a, b) => (a.data.title || "").localeCompare(b.data.title || ""))
  );

  eleventyConfig.addCollection("featuredGalleries", (api) =>
    api.getAll()
      .filter((i) => String(i.data.publish).trim().toLowerCase() === "true" && i.data.Type === "Gallery" && i.data.featured === true && !i.data["home-gallery"])
      .sort((a, b) => (a.data.title || "").localeCompare(b.data.title || ""))
  );

  eleventyConfig.addCollection("regularGalleries", (api) =>
    api.getAll()
      .filter((i) => String(i.data.publish).trim().toLowerCase() === "true" && i.data.Type === "Gallery" && i.data.featured !== true && !i.data["home-gallery"])
      .sort((a, b) => (a.data.title || "").localeCompare(b.data.title || ""))
  );

  eleventyConfig.addCollection("homeGallery", (api) =>
    api.getAll()
      .filter((i) => String(i.data.publish).trim().toLowerCase() === "true" && i.data["home-gallery"] === true)
  );

  eleventyConfig.addFilter("extractImages", (html) => {
    if (!html) return [];
    const re = /<img\s[^>]*>/g;
    const imgs = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      const tag = m[0];
      const src = (tag.match(/src="([^"]+)"/) || [])[1];
      let alt = (tag.match(/alt="([^"]*)"/) || [])[1] || "";
      alt = alt.replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'");
      if (src) imgs.push({ src, alt });
    }
    return imgs;
  });

  eleventyConfig.addFilter("parseGalleryBlocks", (html) => {
    if (!html) return [];

    // Collect inner content from ALL gallery-start/gallery-end pairs
    const chunks = [];
    const lower = html.toLowerCase();
    let searchFrom = 0;
    while (true) {
      const startIdx = lower.indexOf("gallery-start", searchFrom);
      if (startIdx === -1) break;
      const endIdx = lower.indexOf("gallery-end", startIdx);
      if (endIdx === -1) break;
      const actualStart = html.indexOf('>', startIdx) + 1;
      const actualEnd = html.substring(0, endIdx).lastIndexOf('<');
      if (actualStart < actualEnd) chunks.push(html.substring(actualStart, actualEnd));
      searchFrom = endIdx + 11; // advance past "gallery-end"
    }

    const targetHtml = chunks.length ? chunks.join('') : html;

    const hasH2 = /<h2/i.test(targetHtml);
    const slides = [];

    if (hasH2) {
      const blocks = targetHtml.split(/(?=<h2)/i);
      for (let block of blocks) {
        if (!block.trim()) continue;
        
        let blockTitle = "";
        let printStatus = "";
        let verticalAlign = "center";
        let nativeAspect = false;
        const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
        if (titleMatch) {
          let rawTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();

          // Extract print status: [P] = printable, [E] = exclusive (sold), [X] = private
          const statusMatch = rawTitle.match(/\[([PEX])\]/i);
          if (statusMatch) {
            const status = statusMatch[1].toUpperCase();
            if (status === 'P') printStatus = 'available';
            else if (status === 'E') printStatus = 'exclusive';
            else if (status === 'X') printStatus = 'private';
            rawTitle = rawTitle.replace(/\[[PEX]\]/i, '').trim();
          }

          // Extract vertical alignment: [U] = Up (top), [D] = Down (bottom)
          // Also supports nudges: [U10], [D25] etc.
          const alignMatch = rawTitle.match(/\[([UD])(\d*)\]/i);
          if (alignMatch) {
            const dir = alignMatch[1].toUpperCase();
            const val = alignMatch[2];
            if (!val) {
              verticalAlign = (dir === 'U') ? 'top' : 'bottom';
            } else {
              // Convert nudge value to percentage
              // U10 means 10% from top, D10 means 10% from bottom (90%)
              const percent = parseInt(val, 10);
              verticalAlign = (dir === 'U') ? `${percent}%` : `${100 - percent}%`;
            }
            rawTitle = rawTitle.replace(/\[[UD]\d*\]/i, '').trim();
          }

          // [AR] = native aspect ratio (no crop)
          if (/\[AR\]/i.test(rawTitle)) {
            nativeAspect = true;
            rawTitle = rawTitle.replace(/\[AR\]/i, '').trim();
          }

          blockTitle = rawTitle
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        }
        
        if (blockTitle.toLowerCase().includes('gallery-start') || 
            blockTitle.toLowerCase().includes('gallery-end')) continue;

        const contentWithoutTitle = block.replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '');
        
        const iframeRegex = /<iframe[^>]+src="([^"]+)"[^>]*>.*?<\/iframe>/gi;
        const iframesFound = [];
        let im;
        while ((im = iframeRegex.exec(contentWithoutTitle)) !== null) {
          iframesFound.push(im[1]);
        }

        // Detect raw YouTube/Vimeo URLs and convert to embed URLs
        const ytRegex = /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]+)/gi;
        const ytShortRegex = /https?:\/\/youtu\.be\/([\w-]+)/gi;
        const vimeoRegex = /https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/gi;
        let vm;
        while ((vm = ytRegex.exec(contentWithoutTitle)) !== null) {
          iframesFound.push(`https://www.youtube.com/embed/${vm[1]}`);
        }
        while ((vm = ytShortRegex.exec(contentWithoutTitle)) !== null) {
          iframesFound.push(`https://www.youtube.com/embed/${vm[1]}`);
        }
        while ((vm = vimeoRegex.exec(contentWithoutTitle)) !== null) {
          iframesFound.push(`https://player.vimeo.com/video/${vm[1]}`);
        }

        const imgRegex = /<img[^>]+src="([^"]+)"/gi;
        const imgsFound = [];
        let igm;
        while ((igm = imgRegex.exec(contentWithoutTitle)) !== null) {
          imgsFound.push(igm[1]);
        }

        const urlRegex = /((?:https?:\/\/|\/)[^\s<"']+\.(?:jpg|jpeg|png|gif|webp|avif|JPG|JPEG|PNG|GIF|WEBP|AVIF))/gi;
        const rawUrlsFound = [];
        let um;
        while ((um = urlRegex.exec(contentWithoutTitle)) !== null) {
          rawUrlsFound.push(um[1]);
        }
        const uniqueRawUrls = [...new Set(rawUrlsFound)];

        let pureCaption = contentWithoutTitle
          .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
          .replace(/<img[^>]+>/gi, '')
          .replace(/<a[^>]+>https?:\/\/[^<]+<\/a>/gi, '')
          .replace(/(?:(?:https?:\/\/|\/)[^\s<"']+\.(?:jpg|jpeg|png|gif|webp|avif|JPG|JPEG|PNG|GIF|WEBP|AVIF))/gi, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/<p>\s*<\/p>/gi, '')
          .trim();

        // Extract pipe-separated gear line from caption (works whether inline or separate paragraph)
        const plainText = pureCaption.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
        const lines = plainText.split('\n').map(l => l.trim()).filter(l => l);
        const gearLine = lines.find(l => l.includes('|'));
        const gear = gearLine || "";
        // Extract the loc: lat, lng [H] line (GPS coords for the photo map — never shown in captions)
        const locLine = lines.find(l => /^loc:/i.test(l));
        if (gear || locLine) {
          const captionText = lines.filter(l => l !== gearLine && l !== locLine).join(' ').trim();
          pureCaption = captionText ? `<p>${captionText}</p>` : "";
        }

        iframesFound.forEach((src, idx) => {
          slides.push({
            type: "iframe",
            src: src,
            title: iframesFound.length > 1 ? `${blockTitle} (${idx + 1})` : blockTitle,
            printStatus: idx === 0 ? printStatus : "",
            verticalAlign: idx === 0 ? verticalAlign : "center",
            nativeAspect,
            caption: idx === 0 ? pureCaption : "",
            gear: idx === 0 ? gear : ""
          });
        });

        imgsFound.forEach((src, idx) => {
          slides.push({
            type: "image",
            src: src,
            title: imgsFound.length > 1 ? `${blockTitle} (${idx + 1})` : blockTitle,
            printStatus: (idx === 0 && iframesFound.length === 0) ? printStatus : "",
            verticalAlign: (idx === 0 && iframesFound.length === 0) ? verticalAlign : "center",
            nativeAspect,
            caption: (idx === 0 && iframesFound.length === 0) ? pureCaption : "",
            gear: (idx === 0 && iframesFound.length === 0) ? gear : ""
          });
        });

        if (iframesFound.length === 0 && imgsFound.length === 0) {
          uniqueRawUrls.forEach((src, idx) => {
            slides.push({
              type: "image",
              src: src,
              title: uniqueRawUrls.length > 1 ? `${blockTitle} (${idx + 1})` : blockTitle,
              printStatus: idx === 0 ? printStatus : "",
              verticalAlign: idx === 0 ? verticalAlign : "center",
              nativeAspect,
              caption: idx === 0 ? pureCaption : "",
              gear: idx === 0 ? gear : ""
            });
          });
        }
      }
    }

    return slides;
  });

  eleventyConfig.addFilter("buildMapPins", (galleries) => {
    if (!galleries) return [];
    const pins = [];

    // Matches both <img src="..."> and bare /static/images/xxx.webp URLs
    const imgSrcRe  = /<img[^>]+src="(\/static\/images\/([A-Za-z0-9_\-]+\.[a-z]+))"/i;
    const rawUrlRe  = /(?:^|[\s"'(>])((\/static\/images\/)([A-Za-z0-9_\-]+\.(?:webp|jpg|jpeg|png)))/im;
    // "loc: 20.244442, 79.471181" — optionally followed by " [H]" to flag it for the homepage widget
    const locRe = /loc:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(\[H\])?/i;

    for (const gallery of galleries) {
      const html = gallery.templateContent || '';
      const galleryTitle = gallery.data.title || '';
      const galleryUrl = gallery.url || '';

      const blocks = html.split(/(?=<h2)/i);
      for (const block of blocks) {
        const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
        if (!titleMatch) continue;

        let title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
        title = title.replace(/\[[A-Z]{1,3}\d*\]/gi, '').trim();
        if (!title || /gallery-(start|end)|testimonials-(start|end)/i.test(title)) continue;

        // Try <img src> first, then bare URL
        let src;
        const imgMatch = block.match(imgSrcRe);
        if (imgMatch) {
          src = imgMatch[1];
        } else {
          const rawMatch = block.match(rawUrlRe);
          if (!rawMatch) continue;
          src = rawMatch[1].trim();
        }

        const locMatch = block.replace(/<[^>]+>/g, ' ').match(locRe);
        if (!locMatch) continue;
        const lat = parseFloat(locMatch[1]);
        const lng = parseFloat(locMatch[2]);
        const homepage = !!locMatch[3];

        const caption = block
          .replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '')
          .replace(/<img[^>]+>/gi, '')
          .replace(/\/static\/images\/[^\s<"']+/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/loc:\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*(?:\[H\])?/gi, '')
          .replace(/\s+/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .trim();

        pins.push({ src, title, caption, galleryTitle, galleryUrl, lat, lng, homepage });
      }
    }

    return pins;
  });

  // Photos flagged with " [H]" on their loc: line in a gallery caption
  eleventyConfig.addFilter("onlyHomepage", (pins) => (pins || []).filter((p) => p.homepage));

  eleventyConfig.addFilter("parseMapBlocks", (html) => {
    if (!html) return [];
    const pins = [];
    const hasH2 = /<h2/i.test(html);
    if (!hasH2) return [];

    const blocks = html.split(/(?=<h2)/i);
    for (const block of blocks) {
      if (!block.trim()) continue;

      const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
      if (!titleMatch) continue;
      const title = titleMatch[1].replace(/<[^>]+>/g, '').trim()
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      const content = block.replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, '');
      const plainText = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      // Find image URL (http or local path)
      const imgMatch = plainText.match(/((?:https?:\/\/|\/)\S+\.(?:jpg|jpeg|png|gif|webp|avif))/i);
      const image = imgMatch ? imgMatch[1] : null;

      // Find coordinates — match "lat, lng" or "lat,lng"
      const coordMatch = plainText.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
      if (!coordMatch) continue;
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);

      if (image && !isNaN(lat) && !isNaN(lng)) {
        pins.push({ title, image, lat, lng });
      }
    }
    return pins;
  });

  eleventyConfig.addCollection("maps", (api) =>
    api.getAll()
      .filter((i) => String(i.data.publish).trim().toLowerCase() === "true" && i.data.Type === "Map")
  );

  eleventyConfig.addCollection("photoStories", (api) =>
    api.getAll()
      .filter((i) => String(i.data.publish).trim().toLowerCase() === "true" && i.data.Type === "Photo Story")
      .sort((a, b) => b.date - a.date)
  );

  eleventyConfig.addCollection("videos", (api) =>
    api.getAll()
      .filter((i) => String(i.data.publish).trim().toLowerCase() === "true" && i.data.Type === "Video")
      .sort((a, b) => b.date - a.date)
  );

  eleventyConfig.addCollection("featuredVideos", (api) =>
    api.getAll()
      .filter((i) => String(i.data.publish).trim().toLowerCase() === "true" && i.data.Type === "Video" && i.data.featured === true)
      .sort((a, b) => b.date - a.date)
  );

  eleventyConfig.addCollection("regularVideos", (api) =>
    api.getAll()
      .filter((i) => String(i.data.publish).trim().toLowerCase() === "true" && i.data.Type === "Video" && i.data.featured !== true)
      .sort((a, b) => b.date - a.date)
  );

  eleventyConfig.addFilter("relatedGalleries", (collection, currentUrl, tags) => {
    if (!collection?.length || !tags?.length) return [];

    const pageTags = Array.from(tags).map(t => String(t).toLowerCase().trim());

    // Count how often each tag appears so common tags score less
    const freq = {};
    collection.forEach(i => {
      (i.data.tags || []).forEach(t => {
        const k = String(t).toLowerCase().trim();
        freq[k] = (freq[k] || 0) + 1;
      });
    });

    return collection
      .filter(i => {
        if (i.url === currentUrl) return false;
        const itemTags = (i.data.tags || []).map(t => String(t).toLowerCase().trim());
        return itemTags.some(t => pageTags.includes(t));
      })
      .map(i => {
        const itemTags = (i.data.tags || []).map(t => String(t).toLowerCase().trim());
        const score = itemTags
          .filter(t => pageTags.includes(t))
          .reduce((sum, t) => sum + 1 / (freq[t] || 1), 0);
        return { item: i, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(r => r.item);
  });

  eleventyConfig.addFilter("relatedPosts", (collection, currentUrl, tags) => {
    if (!collection?.length || !tags?.length) return [];

    const pageTags = Array.from(tags).map(t => String(t).toLowerCase().trim());

    // Count how often each tag appears so common tags score less
    const freq = {};
    collection.forEach(i => {
      (i.data.tags || []).forEach(t => {
        const k = String(t).toLowerCase().trim();
        freq[k] = (freq[k] || 0) + 1;
      });
    });

    return collection
      .filter(i => {
        if (i.url === currentUrl) return false;
        const itemTags = (i.data.tags || []).map(t => String(t).toLowerCase().trim());
        return itemTags.some(t => pageTags.includes(t));
      })
      .map(i => {
        const itemTags = (i.data.tags || []).map(t => String(t).toLowerCase().trim());
        const score = itemTags
          .filter(t => pageTags.includes(t))
          .reduce((sum, t) => sum + 1 / (freq[t] || 1), 0);
        return { item: i, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(r => r.item);
  });

  eleventyConfig.addCollection("currentProject", (api) =>
    api.getAll()
      .filter((i) => i.data.current_project === true)
  );

  return {
    pathPrefix: process.env.ELEVENTY_PATH_PREFIX || "/",
    dir: {
      input: ".",
      output: "_site",
      includes: "templates",
      layouts: "templates",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}

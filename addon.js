const { addonBuilder } = require("stremio-addon-sdk");

const manifest = {
    id: "org.arabic.autosync.subs",
    version: "1.2.0",
    name: "Arabic Auto-Sync (Render)",
    description: "ترجمة عربية احترافية مزامنة تلقائياً من OpenSubtitles v3 و SubDL",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    // يمكنك وضع رابط صورة لوجو هنا ليظهر في Stremio
    logo: "https://cdn-icons-png.flaticon.com/512/1532/1532556.png", 
    background: "https://images.alphacoders.com/516/516664.jpg",
    contactEmail: "admin@example.com"
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id, type } = args;
    console.log(`[STREMIO] طلب ترجمة لـ: ${id} | النوع: ${type}`);

    try {
        const engine = require("./engine");
        // استدعاء محرك البحث والمزامنة
        const subtitleData = await engine.getSyncedSubtitles(id);

        if (subtitleData) {
            return Promise.resolve({
                subtitles: [
                    {
                        id: `sync_${id}_ar`,
                        lang: "ara", // كود اللغة العربية الرسمي
                        url: subtitleData.proxyUrl, // الرابط الذي يوفره محركك
                        label: `🇸🇦 العربية - مزمّنة (${subtitleData.source})`
                    }
                ]
            });
        }
    } catch (e) {
        console.error(`[STREMIO-ERROR] فشل في معالجة الطلب: ${e.message}`);
    }

    return Promise.resolve({ subtitles: [] });
});

module.exports = builder.getInterface();

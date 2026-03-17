const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.arabic.autosync.subs",
    version: "1.2.6",
    name: "Arabic Auto-Sync",
    description: "ترجمة عربية مزمّنة تلقائياً",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    logo: "https://cdn-icons-png.flaticon.com/512/1532/1532556.png"
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id } = args;
    try {
        const subtitleData = await engine.getSyncedSubtitles(id);
        if (subtitleData) {
            const domain = "chb-gy3n.onrender.com";
            return {
                subtitles: [
                    {
                        id: `sync_${id}_ar`,
                        lang: "ara",
                        url: `https://${domain}/sub/${id}.srt`,
                        label: `🇸🇦 العربية (مُزامنة: ${subtitleData.source})`
                    }
                ]
            };
        }
    } catch (e) {
        console.error(e);
    }
    return { subtitles: [] };
});

module.exports = builder.getInterface();

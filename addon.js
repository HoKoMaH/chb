const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.stremio.arsasubs.v4", 
    version: "4.0.1",
    name: "AR.SA Multi-Sync",
    description: "ترجمات متعددة مزمّنة تلقائياً",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    logo: "https://cdn-icons-png.flaticon.com/512/1532/1532556.png"
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id } = args;
    try {
        const subtitlesList = await engine.getSyncedSubtitles(id);
        if (subtitlesList && subtitlesList.length > 0) {
            const domain = "chb-gy3n.onrender.com";
            return {
                subtitles: subtitlesList.map(sub => ({
                    id: sub.fileId,
                    lang: "ar-sa",
                    url: `https://${domain}/sub/${sub.fileId}.srt`,
                    label: `🇸🇦 ar.sa | ${sub.label}`
                }))
            };
        }
    } catch (e) {
        console.error(e);
    }
    return { subtitles: [] };
});

module.exports = builder.getInterface();

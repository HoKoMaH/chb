const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    // تم تغيير الـ ID لضمان ظهورها كإضافة جديدة تماماً
    id: "org.stremio.arsasubs.premium", 
    version: "2.0.0",
    name: "AR.SA Subtitles",
    description: "Auto-Synced Arabic Subtitles for Movies and Series",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    logo: "https://cdn-icons-png.flaticon.com/512/1532/1532556.png"
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id } = args;
    console.log(`[STREMIO] Request for ID: ${id}`);

    try {
        const subtitleData = await engine.getSyncedSubtitles(id);

        if (subtitleData) {
            const domain = "chb-gy3n.onrender.com";
            const subUrl = `https://${domain}/sub/${id}.srt`;

            return {
                subtitles: [
                    {
                        id: `arsasubs_${id}`,
                        lang: "ar.sa", // هذا سيجعلها تظهر باسم القسم الذي طلبته
                        url: subUrl,
                        label: `🇸🇦 AR.SA - ${subtitleData.source}`
                    }
                ]
            };
        }
    } catch (e) {
        console.error(`[HANDLER-ERROR] ${e.message}`);
    }

    return { subtitles: [] };
});

module.exports = builder.getInterface();

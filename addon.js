const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.stremio.arsasubs.premium", 
    version: "2.5.0", // رفع النسخة ضروري جداً لتحديث الواجهة
    name: "AR.SA Subtitles",
    description: "توفير ترجمة مزمّنة تلقائياً بقسم خاص",
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
            const subUrl = `https://${domain}/sub/${id}.srt`;

            return {
                subtitles: [
                    {
                        id: `arsasubs_${id}`,
                        // تغيير lang إلى ar-SA سيجعلها تظهر كخيار لغة مستقل
                        lang: "ar-SA", 
                        url: subUrl,
                        // الـ label هو ما سيظهر تحت اسم اللغة (مثل SubDL Subtitles في صورتك)
                        label: `🇸🇦 ar.sa - AutoSync`
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

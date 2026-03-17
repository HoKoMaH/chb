const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.stremio.arsasubs.premium", 
    version: "2.6.0", // رفع النسخة مهم جداً لتحديث الواجهة عندك
    name: "AR.SA Subtitles",
    description: "إضافة الترجمة الاحترافية - قسم ar.sa",
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
                        // 'ar-sa' ستجعلها تظهر كخيار لغة منفصل في العمود الأيسر
                        lang: "ar-sa", 
                        url: subUrl,
                        // النص أدناه سيظهر في العمود الأوسط مكان 'SubDL Subtitles'
                        label: "ar.sa" 
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

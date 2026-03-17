const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.stremio.arsasubs.premium", 
    version: "2.7.0", 
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

            // --- هذا هو اللوق المطلوب للتأكد من الرابط ---
            console.log("-----------------------------------------");
            console.log(`✅ تم العثور على ترجمة للفيلم: ${id}`);
            console.log(`🔗 رابط التحميل المباشر: ${subUrl}`);
            console.log("-----------------------------------------");

            return {
                subtitles: [
                    {
                        id: `arsasubs_${id}`,
                        lang: "ar-sa", 
                        url: subUrl,
                        label: "ar.sa" 
                    }
                ]
            };
        } else {
            console.log(`⚠️ لم يتم العثور على ترجمة لـ ${id} في المصادر.`);
        }
    } catch (e) {
        console.error(`[HANDLER-ERROR] ${e.message}`);
    }

    return { subtitles: [] };
});

module.exports = builder.getInterface();

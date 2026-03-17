const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.stremio.arsasubs.premium", 
    version: "2.1.0", // رفعنا النسخة لضمان التحديث
    name: "AR.SA Subtitles",
    description: "إضافة الترجمة المزامنة تلقائياً - قسم AR.SA",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    logo: "https://cdn-icons-png.flaticon.com/512/1532/1532556.png"
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id } = args;
    
    try {
        // استدعاء المحرك لجلب بيانات الترجمة من MongoDB أو السكرابر
        const subtitleData = await engine.getSyncedSubtitles(id);

        if (subtitleData) {
            const domain = "chb-gy3n.onrender.com";
            const subUrl = `https://${domain}/sub/${id}.srt`;

            return {
                subtitles: [
                    {
                        id: `arsasubs_${id}`,
                        lang: "ara", // الكود ara يضمن ظهورها في قائمة "العربية"
                        url: subUrl,
                        // هنا نضع اسم القسم ar.sa الذي طلبته ليظهر بجانب العلم
                        label: `🇸🇦 ar.sa - مزمّنة` 
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

const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.stremio.arsasubs.v7.final", // تحديث النسخة لمسح الكاش القديم
    version: "7.0.0",
    name: "AR.SA Ultimate-Sync",
    description: "ترجمات أصلية + ترجمة فورية بالذكاء الاصطناعي (AI) للأفلام النادرة",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    logo: "https://cdn-icons-png.flaticon.com/512/1532/1532556.png"
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id, extra } = args;
    const videoFileName = extra.filename || ""; 

    console.log(`[STREMIO] طلب لفيلم: ${id} | الملف: ${videoFileName}`);

    try {
        // استدعاء المحرك الذي يبحث في القاعدة ثم المصادر
        const subtitlesList = await engine.getSyncedSubtitles(id, videoFileName);

        if (subtitlesList && subtitlesList.length > 0) {
            const domain = "chb-gy3n.onrender.com";
            
            return {
                subtitles: subtitlesList.map(sub => {
                    // إضافة إيموجي الروبوت 🤖 للترجمة المترجمة آلياً
                    // وإضافة النجمة ⭐ للنسخة المزامنة مع ملف المستخدم
                    let label = `ar.sa | ${sub.label}`;
                    
                    if (sub.isAI) label = `🤖 AI | ${sub.label}`;
                    if (sub.isMatch) label = `⭐ ${label}`;

                    return {
                        id: sub.fileId,
                        lang: "ar-sa",
                        url: `https://${domain}/sub/${sub.fileId}.srt`,
                        label: label
                    };
                })
            };
        }
    } catch (e) {
        console.error(`[ADDON-ERROR] ${e.message}`);
    }
    return { subtitles: [] };
});

module.exports = builder.getInterface();

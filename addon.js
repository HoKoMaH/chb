const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.stremio.arsasubs.v7.final",
    version: "7.0.0",
    name: "AR.SA Ultimate-Sync",
    description: "نظام المزامنة والترجمة الذكية الشامل",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    logo: "https://raw.githubusercontent.com/HoKoMaH/chb/main/logo.png"
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id, extra } = args;
    const videoFileName = extra.filename || "Unknown_File"; 

    console.log(`\n[STREMIO-REQUEST] 📥 طلب جديد:`);
    console.log(`   - معرف المحتوى: ${id}`);
    console.log(`   - اسم الملف: ${videoFileName}`);

    try {
        const subtitlesList = await engine.getSyncedSubtitles(id, videoFileName);

        if (subtitlesList && subtitlesList.length > 0) {
            console.log(`[STREMIO-RESPONSE] ✅ إرسال ${subtitlesList.length} ترجمة إلى التطبيق.`);
            const domain = "chb-gy3n.onrender.com";
            
            return {
                subtitles: subtitlesList.map(sub => {
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
        } else {
            console.log(`[STREMIO-RESPONSE] ⚠️ لا توجد نتائج لإرسالها.`);
        }
    } catch (e) {
        console.error(`[STREMIO-ERROR] ❌ خطأ في المعالجة: ${e.message}`);
    }
    return { subtitles: [] };
});

module.exports = builder.getInterface();

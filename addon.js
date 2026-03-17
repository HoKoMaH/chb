const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.stremio.arsasubs.v4.final", // تغيير الـ ID لإجبار ستريمو على التحديث
    version: "4.1.0",
    name: "AR.SA Multi-Sync",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    console.log("-----------------------------------------");
    console.log(`[ADDON] وصل طلب جديد! ID: ${args.id}`);
    
    try {
        const subtitlesList = await engine.getSyncedSubtitles(args.id);
        
        console.log(`[ADDON] عدد النتائج من المحرك: ${subtitlesList ? subtitlesList.length : 0}`);

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
        console.error(`[ADDON-ERROR] خطأ في الهاندلر: ${e.message}`);
    }
    return { subtitles: [] };
});

module.exports = builder.getInterface();

const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.stremio.arsasubs.v5.auto", 
    version: "5.0.0",
    name: "AR.SA Smart-Sync",
    description: "مزامنة ذكية تعتمد على اسم ملف الفيديو وأول نطق للكلام",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    logo: "https://cdn-icons-png.flaticon.com/512/1532/1532556.png"
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id, extra } = args;
    // استخراج اسم الفيلم المشغل حالياً (مثلاً: Movie.Name.1080p.BluRay.YTS.mp4)
    const videoFileName = extra.filename || ""; 

    try {
        const subtitlesList = await engine.getSyncedSubtitles(id, videoFileName);

        if (subtitlesList && subtitlesList.length > 0) {
            const domain = "chb-gy3n.onrender.com";

            return {
                subtitles: subtitlesList.map(sub => ({
                    id: sub.fileId,
                    lang: "ar-sa",
                    url: `https://${domain}/sub/${sub.fileId}.srt`,
                    // عرض علامة النجمة إذا كانت النسخة مطابقة لملفك
                    label: sub.isMatch ? `⭐ ar.sa | ${sub.label}` : `🇸🇦 ar.sa | ${sub.label}`
                }))
            };
        }
    } catch (e) {
        console.error(`[ADDON-ERROR] ${e.message}`);
    }
    return { subtitles: [] };
});

module.exports = builder.getInterface();

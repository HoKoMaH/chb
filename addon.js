const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

const manifest = {
    id: "org.arabic.autosync.subs",
    version: "1.2.5", // رفع النسخة لإجبار ستريمو على التحديث
    name: "Arabic Auto-Sync",
    description: "ترجمة عربية مزمّنة تلقائياً",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    logo: "https://cdn-icons-png.flaticon.com/512/1532/1532556.png"
};

const builder = new addonBuilder(manifest);

builder.defineSubtitlesHandler(async (args) => {
    const { id } = args;
    console.log(`[STREMIO] استلام طلب لـ: ${id}`);

    try {
        const subtitleData = await engine.getSyncedSubtitles(id);

        if (subtitleData) {
            // تأكد من استبدال الاسم أدناه باسم مشروعك في رندر
            const domain = process.env.RENDER_EXTERNAL_HOSTNAME || "your-app-name.onrender.com";
            const subUrl = `https://${domain}/sub/${id}.srt`;

            console.log(`[STREMIO] إرسال رابط الترجمة: ${subUrl}`);

            return {
                subtitles: [
                    {
                        id: `sync_${id}_ar`,
                        lang: "ara", // الكود ara هو الأضمن لظهور كلمة Arabic
                        url: subUrl,
                        label: `🇸🇦 العربية (مُزامنة: ${subtitleData.source})`
                    }
                ]
            };
        }
    } catch (e) {
        console.error(`[STREMIO-ERROR] فشل إرسال الرد: ${e.message}`);
    }

    return { subtitles: [] };
});

module.exports = builder.getInterface();

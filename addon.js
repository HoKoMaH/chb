const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine"); // استيراد المحرك هنا

const manifest = {
    id: "org.arabic.autosync.subs",
    version: "1.2.0",
    name: "Arabic Auto-Sync (Render)",
    description: "ترجمة عربية احترافية مزمّنة تلقائياً",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    logo: "https://cdn-icons-png.flaticon.com/512/1532/1532556.png"
};

const builder = new addonBuilder(manifest);

// يجب أن تكون الأكواد داخل الـ Handler حصراً
builder.defineSubtitlesHandler(async (args) => {
    const { id } = args;
    console.log(`[STREMIO] طلب ترجمة لـ: ${id}`);

    try {
        // استدعاء المحرك لجلب البيانات
        const subtitleData = await engine.getSyncedSubtitles(id);

        // التحقق من المتغير "داخل" الوظيفة
        if (subtitleData) {
            // ملاحظة: استبدل YOUR_APP_NAME باسم مشروعك في رندر
            const subUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'your-app-name.onrender.com'}/sub/${id}.srt`;

            return {
                subtitles: [
                    {
                        id: `sync_${id}_ar`,
                        lang: "ara",
                        url: subUrl,
                        label: `🇸🇦 العربية - مزمّنة (${subtitleData.source})`
                    }
                ]
            };
        }
    } catch (e) {
        console.error(`[STREMIO-ERROR] فشل المعالجة: ${e.message}`);
    }

    // في حال عدم وجود ترجمة، نرجع مصفوفة فارغة
    return { subtitles: [] };
});

module.exports = builder.getInterface();

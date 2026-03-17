builder.defineSubtitlesHandler(async (args) => {
    const { id } = args;
    console.log(`[STREMIO] طلب ترجمة لـ: ${id}`);

    try {
        const subtitleData = await engine.getSyncedSubtitles(id);

        if (subtitleData) {
            // الرابط الفعلي الخاص بك على رندر
            const domain = "chb-gy3n.onrender.com"; 
            const subUrl = `https://${domain}/sub/${id}.srt`;

            console.log(`[STREMIO] إرسال الرابط النهائي: ${subUrl}`);

            return {
                subtitles: [
                    {
                        id: `sync_${id}_ar`,
                        lang: "ara",
                        url: subUrl,
                        label: `🇸🇦 العربية (مُزامنة: ${subtitleData.source})`
                    }
                ]
            };
        }
    } catch (e) {
        console.error(`[STREMIO-ERROR] فشل: ${e.message}`);
    }
    return { subtitles: [] };
});

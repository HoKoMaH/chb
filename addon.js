// داخل defineSubtitlesHandler...
if (subtitleData) {
    // الرابط يجب أن يشير إلى السيرفر الخاص بك على Render
    const subUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'your-app-name.onrender.com'}/sub/${id}.srt`;
    
    return Promise.resolve({
        subtitles: [
            {
                id: `sync_${id}_ar`,
                lang: "ara",
                url: subUrl,
                label: `🇸🇦 العربية - مزمّنة (${subtitleData.source})`
            }
        ]
    });
}

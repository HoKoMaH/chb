// حذفنا السطر الأول القديم const parser = require...

async function syncSrt(arabicSrt, englishSrt) {
    try {
        // استيراد المكتبة بشكل ديناميكي لتجنب خطأ ERR_REQUIRE_ESM
        const { default: Parser } = await import("srt-parser-2");
        const srt = new Parser();

        const ara = srt.fromSrt(arabicSrt);
        const eng = srt.fromSrt(englishSrt);
        
        if (!ara.length || !eng.length) return arabicSrt;

        const offset = timeToMs(eng[0].startTime) - timeToMs(ara[0].startTime);

        const synced = ara.map(line => ({
            ...line,
            startTime: msToTime(timeToMs(line.startTime) + offset),
            endTime: msToTime(timeToMs(line.endTime) + offset)
        }));

        return srt.toSrt(synced);
    } catch (e) { 
        console.error("Sync Engine Error:", e);
        return arabicSrt; 
    }
}

function timeToMs(t) {
    const s = t.split(':');
    return (parseInt(s[0]) * 3600000) + (parseInt(s[1]) * 60000) + (parseFloat(s[2].replace(',', '.')) * 1000);
}

function msToTime(ms) {
    return new Date(ms).toISOString().slice(11, 23).replace('.', ',');
}

module.exports = { syncSrt };
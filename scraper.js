const axios = require('axios');
const AdmZip = require('adm-zip');
const { translate } = require('@vitalets/google-translate-api');

async function translateToArabic(sourceSrt) {
    if (!sourceSrt) return null;
    const lines = sourceSrt.split('\n');
    let batchTexts = [], batchIndices = [];
    const totalLines = lines.length;

    console.log(`[TRANSLATOR] 🤖 معالجة ${totalLines} سطر بنظام التبريد...`);

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (line && !line.includes('-->') && isNaN(line)) {
            batchTexts.push(line);
            batchIndices.push(i);
        }

        if (batchTexts.length === 10 || (i === lines.length - 1 && batchTexts.length > 0)) {
            let success = false, retries = 5;
            while (!success && retries > 0) {
                try {
                    const res = await translate(batchTexts.join(' | '), { to: 'ar' });
                    if (res && res.text) {
                        const parts = res.text.split(' | ');
                        for (let j = 0; j < batchIndices.length; j++) {
                            lines[batchIndices[j]] = parts[j] || batchTexts[j];
                        }
                        success = true;
                    }
                } catch (e) {
                    retries--;
                    console.log(`[WAIT] ⚠️ ضغط عند السطر ${i}.. انتظار 5 ثوانٍ...`);
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
            if (i % 100 === 0) console.log(`[PROGRESS] ⏳ ${((i/totalLines)*100).toFixed(1)}%`);
            await new Promise(r => setTimeout(r, 500)); // تأخير ثابت لمنع الحظر
        }
    }
    return lines.join('\n');
}

async function fetchAllPossibleSubs(fullId, videoFileName) {
    const API_KEY = process.env.SUBDL_API_KEY;
    const parts = fullId.split(':');
    const technicalTags = (videoFileName || "").toUpperCase().match(/(BLURAY|WEB-DL|NF|WEBRIP|YTS|PSA|AMZN|H264)/g) || [];

    try {
        let url = `https://api.subdl.com/api/v1/subtitles?imdb_id=${parts[0]}&api_key=${API_KEY}`;
        if (parts[1]) url += `&season=${parts[1]}&episode=${parts[2]}`;

        // 1. بحث عربي
        const arRes = await axios.get(url + '&languages=ar').catch(() => null);
        if (arRes?.data?.subtitles?.length > 0) return await processSubs(arRes.data.subtitles, "Original");

        // 2. تعريب عالمي
        const allRes = await axios.get(url).catch(() => null);
        if (allRes?.data?.subtitles?.length > 0) {
            const best = allRes.data.subtitles.sort((a,b) => {
                const sA = technicalTags.filter(t => a.release_name.toUpperCase().includes(t)).length;
                const sB = technicalTags.filter(t => b.release_name.toUpperCase().includes(t)).length;
                return sB - sA;
            })[0];
            const content = await downloadAndUnzip(best.url);
            const translated = await translateToArabic(content);
            return [{ content: translated, releaseName: best.release_name, source: "AI" }];
        }
    } catch (e) { return []; }
}

async function downloadAndUnzip(subUrl) {
    try {
        const res = await axios.get(`https://dl.subdl.com${subUrl}`, { responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(res.data));
        const entry = zip.getEntries().find(e => e.entryName.endsWith('.srt'));
        return entry ? entry.getData().toString('utf8') : null;
    } catch (e) { return null; }
}

async function processSubs(subs, type) {
    let list = [];
    for (let s of subs) {
        const content = await downloadAndUnzip(s.url);
        if (content) list.push({ content, releaseName: s.release_name, source: type });
    }
    return list;
}

module.exports = { fetchAllPossibleSubs, translateToArabic };

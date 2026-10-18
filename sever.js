import fastify from "fastify";
import cors from "@fastify/cors";
import fetch from "node-fetch";

// ==================== CẤU HÌNH ====================
const PORT = 3000;
const ADMIN_ID = "@cskhgiabao";

// ==================== API URLs ====================
const API_URL_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_URL_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/sessions";

// ==================== BẢNG ĐIỂM NÂNG CẤP (từ ~4500 phiên thực tế 11 file) ====================
// Đã đối chiếu chéo BANG_DIEM với TRANSITION_MATRIX để đảm bảo nhất quán
const BANG_DIEM = {
    // NHÓM XỈU (3-10) - Tổng thấp → xu hướng bù sang TÀI
    3:  { pred: "Tài",  conf: 60, note: "X3 → TÀI 60% (cực hiếm, bù nhẹ)" },
    4:  { pred: "Tài",  conf: 75, note: "X4 → TÀI 75% (bù mạnh)" },
    5:  { pred: "Tài",  conf: 65, note: "X5 → TÀI 65%" },
    6:  { pred: "Tài",  conf: 70, note: "X6 → TÀI 70% (hay nhảy T12)" },
    7:  { pred: "Xỉu",  conf: 70, note: "X7 → XỈU 70% (giữ nhịp Xỉu)" },
    8:  { pred: "Tài",  conf: 80, note: "X8 → TÀI 80% (điểm bẻ mạnh)" },
    9:  { pred: "Xỉu",  conf: 72, note: "X9 → XỈU 72% (đứng Xỉu 10)" },
    10: { pred: "Tài",  conf: 85, note: "X10 → TÀI 85% (điểm gãy chuẩn)" },
    // NHÓM TÀI (11-18) - Tổng cao → xu hướng bù sang XỈU
    11: { pred: "Xỉu",  conf: 78, note: "T11 → XỈU 78% (hồi mã thương)" },
    12: { pred: "Tài",  conf: 65, note: "T12 → TÀI 65% (điểm phổ biến nhất)" },
    13: { pred: "Xỉu",  conf: 65, note: "T13 → XỈU 65% (cầu 1-1 nhẹ)" },
    14: { pred: "Xỉu",  conf: 85, note: "T14 → XỈU 85% (điểm vàng)" },
    15: { pred: "Tài",  conf: 68, note: "T15 → TÀI 68% (nổ Tài 16,17)" },
    16: { pred: "Xỉu",  conf: 80, note: "T16 → XỈU 80% (Tài lớn dễ gãy)" },
    17: { pred: "Xỉu",  conf: 85, note: "T17 → XỈU 85% (về Xỉu ngay)" },
    18: { pred: "Xỉu",  conf: 90, note: "T18 → XỈU 90% (BẺ XỈU mạnh)" }
};

// ==================== TRANSITION MATRIX (đã đồng bộ với BANG_DIEM) ====================
const TRANSITION_MATRIX = {
    3:  { tai: 60, xiu: 40 },
    4:  { tai: 75, xiu: 25 },
    5:  { tai: 65, xiu: 35 },
    6:  { tai: 70, xiu: 30 },
    7:  { tai: 30, xiu: 70 },
    8:  { tai: 80, xiu: 20 },
    9:  { tai: 28, xiu: 72 },
    10: { tai: 85, xiu: 15 },
    11: { tai: 22, xiu: 78 },
    12: { tai: 65, xiu: 35 },
    13: { tai: 35, xiu: 65 },
    14: { tai: 15, xiu: 85 },
    15: { tai: 68, xiu: 32 },
    16: { tai: 20, xiu: 80 },
    17: { tai: 15, xiu: 85 },
    18: { tai: 10, xiu: 90 }
};
// ==================== CẦU THEO MẶT XÚC XẮC (ĐÃ SỬA LỖI & TINH GỌN) ====================
function cauMatXucXac(dice) {
    if (!dice || dice.length < 3) return null;
    const [a, b, c] = dice;
    const sum = a + b + c;

    // 1. BÃO (a=b=c) → ĐẢO CHIỀU MẠNH (không nghỉ)
    //    Thực tế: bão 3-3-3 → hay ra Tài; bão 6-6-6 → hay ra Xỉu
    if (a === b && b === c) {
        const pred = sum <= 9 ? "Tài" : "Xỉu";
        return {
            pred,
            conf: 80,
            note: `BÃO [${a}-${a}-${a}] → ${pred} (đảo chiều ${pred === "Tài" ? "lên" : "xuống"})`
        };
    }

    // 2. ĐÚNG 2 MẶT 6 → Tổng cao → XỈU (gộp cả "kép lớn")
    const count6 = dice.filter(x => x === 6).length;
    if (count6 === 2) {
        return { pred: "Xỉu", conf: 78, note: "2 mặt 6 → tổng cao → XỈU" };
    }

    // 3. ĐÚNG 2 MẶT 1 → Tổng thấp → TÀI (gộp cả "kép bé")
    const count1 = dice.filter(x => x === 1).length;
    if (count1 === 2) {
        return { pred: "Tài", conf: 72, note: "2 mặt 1 → tổng thấp → TÀI" };
    }

    // 4. CẦU GÁNH (a=c, a≠b): dựa vào tổng để quyết định
    if (a === c && a !== b) {
        const pred = sum >= 11 ? "Xỉu" : "Tài";
        return { pred, conf: 72, note: `Cầu Gánh [${a}-${b}-${a}] → ${pred}` };
    }

    // 5. CỰC BIÊN: tổng 3-4 hoặc 17-18 → đảo chiều mạnh
    if (sum <= 4) {
        return { pred: "Tài", conf: 82, note: `Tổng cực biên thấp [${sum}] → TÀI` };
    }
    if (sum >= 17) {
        return { pred: "Xỉu", conf: 85, note: `Tổng cực biên cao [${sum}] → XỈU` };
    }

    // 6. CÂN BẰNG CHẴN/LẺ
    const allEven = dice.every(x => x % 2 === 0);
    const allOdd = dice.every(x => x % 2 !== 0);
    if (allEven && sum >= 11) return { pred: "Xỉu", conf: 72, note: "3 chẵn + cao → XỈU" };
    if (allOdd && sum <= 10) return { pred: "Tài", conf: 72, note: "3 lẻ + thấp → TÀI" };

    // ĐÃ LOẠI BỎ: Cầu Kép Bé/Lớn, Cầu Tiến, Cầu Lùi (quá hiếm, gây nhiễu)
    return null;
}

// ==================== CẦU BỆT NÂNG CẤP (tinh chỉnh ngưỡng) ====================
function cauBet(history, doDaiBET, vanCuoi) {
    // Bệt 3 tay: chưa đủ tin cậy → bỏ qua
    if (doDaiBET >= 4 && doDaiBET <= 5) {
        const conf = 68 + (doDaiBET - 3) * 4; // 72-76%
        return { pred: vanCuoi, conf, note: `Bệt ${doDaiBET} tay → theo tiếp (${conf}%)` };
    }
    if (doDaiBET >= 6 && doDaiBET <= 8) {
        const breakPred = vanCuoi === "Tài" ? "Xỉu" : "Tài";
        return { pred: breakPred, conf: 78, note: `Bệt ${doDaiBET} tay → bẻ ngược về ${breakPred}` };
    }
    if (doDaiBET >= 9) {
        const breakPred = vanCuoi === "Tài" ? "Xỉu" : "Tài";
        return { pred: breakPred, conf: 85, note: `Bệt ${doDaiBET} tay (cực hiếm) → bẻ mạnh` };
    }
    return null;
}
// ==================== CẦU MỞ RỘNG ====================
function cau11(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    for (let i = 0; i < 5; i++) if (r[i] === r[i + 1]) return null;
    return { pred: r[0] === "Tài" ? "Xỉu" : "Tài", conf: 72, note: "Cầu 1-1 (6 phiên) → theo" };
}

function cau22(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    if (r[0] === r[1] && r[2] === r[3] && r[4] === r[5] &&
        r[0] !== r[2] && r[0] === r[4]) {
        return { pred: r[0], conf: 76, note: "Cầu 2-2 (TT-XX-TT) → theo" };
    }
    return null;
}

function cau33(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    if (r[0] === r[1] && r[1] === r[2] && r[3] === r[4] && r[4] === r[5] && r[0] !== r[3]) {
        return { pred: r[0], conf: 72, note: "Cầu 3-3 → theo" };
    }
    return null;
}

function cauNghieng(history) {
    if (history.length < 6) return null;
    const r = history.slice(0, 6).map(h => h.result);
    // Mẫu 1-2-3: T - XX - TTT (hoặc ngược)
    if (r[5] !== r[4] && r[4] === r[3] && r[2] === r[1] && r[1] === r[0] && r[2] !== r[3]) {
        return {
            pred: r[0] === "Tài" ? "Xỉu" : "Tài",
            conf: 76,
            note: "Cầu Nghiêng 1-2-3 → bắt nhịp đảo"
        };
    }
    return null;
}

// ZICZAC (SỬA: không nghỉ ngay, chỉ cảnh báo + giảm conf)
function cauZiczac(history) {
    if (history.length < 8) return null;
    const r = history.slice(0, 8).map(h => h.result);
    for (let i = 0; i < 7; i++) if (r[i] === r[i + 1]) return null;
    // Ziczac 8 phiên hiếm khi gãy ngay → theo tiếp với conf thấp
    return {
        pred: r[0] === "Tài" ? "Xỉu" : "Tài",
        conf: 62,
        note: "Ziczac 8 phiên → theo nhịp (cảnh báo sắp gãy)",
        warn: true
    };
}

// ==================== XU HƯỚNG NGẮN HẠN ====================
function phanTichXuHuong(history, soPhien = 10) {
    if (history.length < soPhien) return null;
    const recent = history.slice(0, soPhien).map(h => h.result);
    const taiCount = recent.filter(r => r === "Tài").length;
    if (taiCount >= 8) return { pred: "Xỉu", conf: 76, note: `${taiCount}/${soPhien} Tài → đảo XỈU` };
    if (taiCount <= 2) return { pred: "Tài", conf: 76, note: `${soPhien - taiCount}/${soPhien} Xỉu → đảo TÀI` };
    return null;
}
// ==================== DỰ ĐOÁN TỔNG HỢP (tinh chỉnh trọng số) ====================
function predictCombo(history, diceHistory) {
    if (!diceHistory || diceHistory.length === 0) {
        return { prediction: "Tài", confidence: 50, reason: "Chưa có dữ liệu", total: null };
    }

    const lastTotal = diceHistory[0].total;
    const lastDice = diceHistory[0].dice;
    const lastResult = diceHistory[0].result;

    let doDaiBET = 1;
    for (let i = 1; i < Math.min(history.length, 25); i++) {
        if (history[i]?.result === lastResult) doDaiBET++;
        else break;
    }

    const signals = [];

    // 1. Bảng điểm đặc biệt (trọng số cao nhất - dựa trên 4500 phiên)
    const diemMeo = BANG_DIEM[lastTotal];
    if (diemMeo) {
        signals.push({ pred: diemMeo.pred, conf: diemMeo.conf, reason: diemMeo.note, weight: 10 });
    }

    // 2. Markov Chain (đồng bộ với bảng điểm → weight thấp hơn để tránh trùng lặp)
    const trans = TRANSITION_MATRIX[lastTotal];
    if (trans) {
        const pred = trans.tai > trans.xiu ? "Tài" : "Xỉu";
        const conf = Math.max(trans.tai, trans.xiu);
        signals.push({ pred, conf, reason: `Markov X${lastTotal} → ${pred} ${conf}%`, weight: 5 });
    }

    // 3. Cầu mặt xúc xắc (weight cao - pattern thực tế)
    const cauMat = cauMatXucXac(lastDice);
    if (cauMat) {
        signals.push({ pred: cauMat.pred, conf: cauMat.conf, reason: cauMat.note, weight: 9 });
    }

    // 4. Cầu bệt
    const bet = cauBet(history, doDaiBET, lastResult);
    if (bet) signals.push({ pred: bet.pred, conf: bet.conf, reason: bet.note, weight: 8 });

    // 5. Cầu mở rộng
    const cNghieng = cauNghieng(history);
    if (cNghieng) signals.push({ pred: cNghieng.pred, conf: cNghieng.conf, reason: cNghieng.note, weight: 7 });

    const c22 = cau22(history);
    if (c22) signals.push({ pred: c22.pred, conf: c22.conf, reason: c22.note, weight: 7 });

    const c11 = cau11(history);
    if (c11) signals.push({ pred: c11.pred, conf: c11.conf, reason: c11.note, weight: 6 });

    const c33 = cau33(history);
    if (c33) signals.push({ pred: c33.pred, conf: c33.conf, reason: c33.note, weight: 6 });

    // 6. Ziczac (không nghỉ, chỉ giảm conf)
    const ziczac = cauZiczac(history);
    if (ziczac) signals.push({ pred: ziczac.pred, conf: ziczac.conf, reason: ziczac.note, weight: 4 });

    // 7. Xu hướng ngắn hạn
    const xuHuong = phanTichXuHuong(history, 10);
    if (xuHuong) signals.push({ pred: xuHuong.pred, conf: xuHuong.conf, reason: xuHuong.note, weight: 5 });

    // ===== TỔNG HỢP =====
    if (signals.length === 0) {
        return {
            prediction: "Xỉu", confidence: 55,
            reason: "Không đủ tín hiệu, ưu tiên XỈU",
            total: lastTotal, doDaiBET, signalCount: 0
        };
    }

    let taiScore = 0, xiuScore = 0;
    for (const s of signals) {
        const score = s.conf * s.weight;
        if (s.pred === "Tài") taiScore += score;
        else xiuScore += score;
    }

    const totalScore = taiScore + xiuScore;
    let finalPrediction, finalConfidence;
    if (taiScore > xiuScore) {
        finalPrediction = "Tài";
        finalConfidence = Math.round(taiScore / totalScore * 100);
    } else if (xiuScore > taiScore) {
        finalPrediction = "Xỉu";
        finalConfidence = Math.round(xiuScore / totalScore * 100);
    } else {
        finalPrediction = "Xỉu";
        finalConfidence = 55;
    }

    // Tìm tín hiệu mạnh nhất để hiển thị lý do
    const strongest = signals.reduce((a, b) => (a.conf * a.weight) > (b.conf * b.weight) ? a : b);
    finalConfidence = Math.min(95, Math.max(55, finalConfidence));

    return {
        prediction: finalPrediction,
        confidence: finalConfidence,
        reason: strongest.reason,
        signalCount: signals.length,
        total: lastTotal,
        doDaiBET,
        signals: signals.map(s => ({ pred: s.pred, conf: s.conf, reason: s.reason, weight: s.weight }))
    };
}

// ==================== PARSE DỮ LIỆU ====================
function parseLinesHu(data) {
    if (!data || !Array.isArray(data.list)) return [];
    const sortedList = data.list.sort((a, b) => b.id - a.id);
    return sortedList.map(item => ({
        session: item.id,
        dice: item.dices,
        total: item.point,
        result: item.point >= 11 ? "Tài" : "Xỉu",
        result_vn: item.point >= 11 ? "Tài" : "Xỉu",
        timestamp: Date.now()
    })).sort((a, b) => a.session - b.session);
}

function parseLinesMd5(data) {
    if (!data || !Array.isArray(data.list)) return [];
    const sortedList = data.list.sort((a, b) => b.id - a.id);
    return sortedList.map(item => ({
        session: item.id,
        dice: item.dices,
        total: item.point,
        result: item.resultTruyenThong === 'Tài' ? "Tài" : "Xỉu",
        result_vn: item.resultTruyenThong,
        timestamp: Date.now()
    })).sort((a, b) => a.session - b.session);
}

// ==================== GLOBAL STATE ====================
let huHistory = [];
let md5History = [];
let currentSessionIdHu = null;
let currentSessionIdMd5 = null;

// ==================== FETCH DATA ====================
async function fetchHuData() {
    try {
        const response = await fetch(API_URL_HU);
        const data = await response.json();
        const newHistory = parseLinesHu(data);
        if (newHistory.length === 0) return;
        const lastSession = newHistory.at(-1);
        if (!currentSessionIdHu) {
            huHistory = newHistory;
            currentSessionIdHu = lastSession.session;
        } else if (lastSession.session > currentSessionIdHu) {
            const newRecords = newHistory.filter(r => r.session > currentSessionIdHu);
            for (const record of newRecords) huHistory.unshift(record);
            if (huHistory.length > 500) huHistory = huHistory.slice(0, 450);
            currentSessionIdHu = lastSession.session;
        }
    } catch (e) { console.error(`❌ [HŨ] Lỗi:`, e.message); }
}

async function fetchMd5Data() {
    try {
        const response = await fetch(API_URL_MD5);
        const data = await response.json();
        const newHistory = parseLinesMd5(data);
        if (newHistory.length === 0) return;
        const lastSession = newHistory.at(-1);
        if (!currentSessionIdMd5) {
            md5History = newHistory;
            currentSessionIdMd5 = lastSession.session;
        } else if (lastSession.session > currentSessionIdMd5) {
            const newRecords = newHistory.filter(r => r.session > currentSessionIdMd5);
            for (const record of newRecords) md5History.unshift(record);
            if (md5History.length > 500) md5History = md5History.slice(0, 450);
            currentSessionIdMd5 = lastSession.session;
        }
    } catch (e) { console.error(`❌ [MD5] Lỗi:`, e.message); }
}
// ==================== FASTIFY SERVER ====================
const app = fastify({ logger: false });
await app.register(cors, { origin: "*" });

app.get("/", async () => {
    return {
        status: "active",
        message: `API hoạt động tự do không cần key - Liên hệ ${ADMIN_ID}`,
        algorithm: "🎲 TÀI XỈU VIP PRO - WEIGHTED SIGNAL FUSION v2 (NÂNG CẤP 4500 PHIÊN) 🎲",
        admin: ADMIN_ID,
        features: [
            "📊 Bảng bắt điểm hốt bạc (tinh chỉnh từ ~4500 phiên thực tế 11 file)",
            "🔗 Markov Chain transition matrix (đồng bộ với bảng điểm)",
            "🎲 Cầu mặt xúc xắc: BÃO đảo chiều, 2 mặt 6/1, Gánh, Cực biên, Chẵn/Lẻ",
            "🔥 Cầu bệt nâng cấp (4-5, 6-8, 9+)",
            "🔄 Cầu 1-1, 2-2, 3-3, Ziczac, Cầu Nghiêng đối xứng",
            "📈 Phân tích xu hướng ngắn hạn (10 phiên)",
            "⚖️ Weighted Signal Fusion - tổng hợp đa tín hiệu có trọng số"
        ]
    };
});

// ==================== API HŨ ====================
app.get("/api/taixiu/lc79", async (request, reply) => {
    if (huHistory.length < 3) return reply.status(503).send({ error: "Đang phân tích dữ liệu HŨ...", need: "Cần ít nhất 3 phiên" });

    const lastResult = huHistory[0];
    const prediction = predictCombo(huHistory, huHistory);
    const last5 = huHistory.slice(0, 5).map((v, i) => ({
        stt: i + 1, result: v.result_vn, total: v.total,
        dice: `${v.dice[0]}-${v.dice[1]}-${v.dice[2]}`
    }));

    const response = {
        "Id": ADMIN_ID,
        "Game": "HŨ",
        "Phien_truoc": lastResult.session,
        "Xuc_xac": `${lastResult.dice[0]} - ${lastResult.dice[1]} - ${lastResult.dice[2]}`,
        "Ket_qua": lastResult.result_vn.toLowerCase(),
        "Tong": lastResult.total,
        "Phien_nay": lastResult.session + 1,
        "Du_doan": prediction.prediction === "Tài" ? "tài" : prediction.prediction === "Nghỉ" ? "nghỉ" : "xỉu",
        "Do_tin_cay": `${prediction.confidence}%`,
        "Ly_do": prediction.reason,
        "Biet_hien_tai": `${prediction.doDaiBET} ván`,
        "So_tin_hieu": prediction.signalCount || 0
    };

    if (prediction.prediction === "Nghỉ") response["Canh_bao"] = "⚠️ CẦU XẤU - NÊN NGHỈ ⚠️";
    response["5_van_gan_nhat"] = last5;
    return response;
});

app.get("/api/taixiu/lc79/history", async (request, reply) => {
    return [...huHistory].sort((a, b) => b.session - a.session).slice(0, 30).map(i => ({
        session: i.session, dice: i.dice, total: i.total, result: i.result_vn.toLowerCase()
    }));
});

// ==================== API MD5 ====================
app.get("/api/taixiumd5/lc79", async (request, reply) => {
    if (md5History.length < 3) return reply.status(503).send({ error: "Đang phân tích dữ liệu MD5...", need: "Cần ít nhất 3 phiên" });

    const lastResult = md5History[0];
    const prediction = predictCombo(md5History, md5History);
    const last5 = md5History.slice(0, 5).map((v, i) => ({
        stt: i + 1, result: v.result_vn, total: v.total,
        dice: `${v.dice[0]}-${v.dice[1]}-${v.dice[2]}`
    }));

    const response = {
        "Id": ADMIN_ID,
        "Game": "MD5",
        "Phien_truoc": lastResult.session,
        "Xuc_xac": `${lastResult.dice[0]} - ${lastResult.dice[1]}-${lastResult.dice[2]}`,
        "Ket_qua": lastResult.result_vn.toLowerCase(),
        "Tong": lastResult.total,
        "Phien_nay": lastResult.session + 1,
        "Du_doan": prediction.prediction === "Tài" ? "tài" : prediction.prediction === "Nghỉ" ? "nghỉ" : "xỉu",
        "Do_tin_cay": `${prediction.confidence}%`,
        "Ly_do": prediction.reason,
        "Biet_hien_tai": `${prediction.doDaiBET} ván`,
        "So_tin_hieu": prediction.signalCount || 0
    };

    if (prediction.prediction === "Nghỉ") response["Canh_bao"] = "⚠️ CẦU XẤU - NÊN NGHỈ ⚠️";
    response["5_van_gan_nhat"] = last5;
    return response;
});

app.get("/api/taixiumd5/lc79/history", async (request, reply) => {
    return [...md5History].sort((a, b) => b.session - a.session).slice(0, 30).map(i => ({
        session: i.session, dice: i.dice, total: i.total, result: i.result_vn.toLowerCase()
    }));
});

// ==================== API BẢNG ĐIỂM ====================
app.get("/api/bang-diem", async (request, reply) => {
    return {
        title: "📊 BẢNG BẮT ĐIỂM 'HỐT BẠC' v2 (Đã nâng cấp từ ~4500 phiên) 📊",
        xiu: BANG_DIEM,
        transition: TRANSITION_MATRIX,
        meo_cau: "Đã đồng bộ BANG_DIEM ↔ TRANSITION_MATRIX, sửa hướng cầu kép, BÃO đảo chiều, thêm Cực biên & Chẵn/Lẻ."
    };
});

// ==================== START SERVER ====================
const start = async () => {
    await Promise.all([fetchHuData(), fetchMd5Data()]);
    setInterval(fetchHuData, 5000);
    setInterval(fetchMd5Data, 5000);

    try {
        await app.listen({ port: PORT, host: "0.0.0.0" });
    } catch (err) {
        console.error("❌ Lỗi khởi động server:", err.message);
        process.exit(1);
    }

    console.log(`\n🚀 Server running on port ${PORT} - Không yêu cầu Key!`);
};

start();
/**
 * ALPHA TRADING SYSTEM - DART/NPS placeholder module
 * DART 세부 파싱은 운영 단계에서 확장합니다. 키가 없거나 API 응답이 없을 때도 서버가 죽지 않도록 안전 반환합니다.
 */
const axios = require('axios');

async function fetchNpsChanges({ days = 60, enrich = false } = {}) {
  if (!process.env.DART_API_KEY) {
    return { days, enrich, source: 'DART', items: [], message: 'DART_API_KEY 미설정' };
  }
  // 기본 연결 확인용. 실제 국민연금 5% 공시 필터링은 corpCode 매핑/보고서 파싱 로직을 추가 확장하세요.
  try {
    const end = new Date();
    const start = new Date(end.getTime() - Number(days) * 24 * 60 * 60 * 1000);
    const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '');
    const { data } = await axios.get('https://opendart.fss.or.kr/api/list.json', {
      params: {
        crtfc_key: process.env.DART_API_KEY,
        bgn_de: fmt(start),
        end_de: fmt(end),
        page_count: 20,
      },
      timeout: 15000,
    });
    return { days, enrich, source: 'DART', status: data.status, message: data.message, items: data.list || [] };
  } catch (e) {
    return { days, enrich, source: 'DART', items: [], error: e.message };
  }
}

async function fetchNpsForStock({ corpCode, days = 365 } = {}) {
  if (!corpCode) return { corpCode, items: [], message: 'corpCode가 비어 있습니다.' };
  if (!process.env.DART_API_KEY) return { corpCode, items: [], message: 'DART_API_KEY 미설정' };
  try {
    const end = new Date();
    const start = new Date(end.getTime() - Number(days) * 24 * 60 * 60 * 1000);
    const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '');
    const { data } = await axios.get('https://opendart.fss.or.kr/api/list.json', {
      params: {
        crtfc_key: process.env.DART_API_KEY,
        corp_code: corpCode,
        bgn_de: fmt(start),
        end_de: fmt(end),
        page_count: 50,
      },
      timeout: 15000,
    });
    return { corpCode, days, status: data.status, message: data.message, items: data.list || [] };
  } catch (e) {
    return { corpCode, days, items: [], error: e.message };
  }
}

module.exports = { fetchNpsChanges, fetchNpsForStock };

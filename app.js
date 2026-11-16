const WALK_SPEED_KMH = 4.5;
const MEAL_MINUTES = 60;
const VISIT_MINUTES = { courtyard: 15, park: 40, exhibition: 60, museum: 90, shop: 45 };
const STORE_KEY = 'dvory-my-places-v1';
const PREFS_KEY = 'dvory-prefs-v1';

const map = L.map('map').setView([59.9343, 30.3351], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
const layer = L.layerGroup().addTo(map);
let currentRoute = [];

// ---------- Обновление мест из places.json ----------
const PLACES_CACHE_KEY = 'dvory-places-cache-v1';
let DATA = {
  version: 0,
  courtyards: COURTYARDS,
  places: PLACES,
  shops: SHOPS,
  exhibitions: EXHIBITIONS,
  nature: NATURE,
  ruins: RUINS,
  cafes: CAFES
};

function applyData(d) {
  const keys = ['courtyards', 'places', 'shops', 'exhibitions', 'nature', 'ruins', 'cafes'];
  const next = { ...DATA, version: d.version || DATA.version };
  keys.forEach(k => { if (Array.isArray(d[k]) && d[k].length) next[k] = d[k]; });
  DATA = next;
}

async function updatePlaces() {
  const status = document.getElementById('updateStatus');
  try {
    const cached = JSON.parse(localStorage.getItem(PLACES_CACHE_KEY));
    if (cached) applyData(cached);
  } catch (e) {}

  try {
    const res = await fetch('places.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    const fresh = await res.json();
    if (typeof fresh.version !== 'number') throw new Error('bad file');
    if (fresh.version >= DATA.version) {
      applyData(fresh);
      localStorage.setItem(PLACES_CACHE_KEY, JSON.stringify(fresh));
    }
    if (status) status.textContent = 'Места обновлены, версия ' + DATA.version;
  } catch (e) {
    if (status) status.textContent = 'Нет связи, работаем с сохранённой версией ' + DATA.version;
  }
}

// ---------- Данные ----------
function loadMine() {
const SPEND_KEY = 'dvory-spend-v1';
function loadSpend() {
  try { return JSON.parse(localStorage.getItem(SPEND_KEY)) || {}; } catch (e) { return {}; }
}
function addSpend(placeId, rub) {
  const all = loadSpend();
  (all[placeId] = all[placeId] || []).push(rub);
  localStorage.setItem(SPEND_KEY, JSON.stringify(all));
}
function avgSpend(placeId) {
  const list = loadSpend()[placeId];
  if (!list || !list.length) return null;
  return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
}
function spendBadge(placeId) {
  const avg = avgSpend(placeId);
  if (avg === null) return ' · чек пока неизвестен';
  const icon = avg < 500 ? '₽' : (avg < 2000 ? '₽₽' : '₽₽₽');
  return ' · ' + icon + ' средний чек ~' + avg + ' ₽';
}
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; }
}
function saveMine(list) { localStorage.setItem(STORE_KEY, JSON.stringify(list)); }

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysLeft(until) {
  const ms = new Date(until + 'T23:59:59') - new Date();
  return Math.ceil(ms / 86400000);
}

function allPlaces() {
  const courtyards = COURTYARDS.map(c => ({ ...c, type: 'courtyard' }));
  const mine = loadMine();
  return [...courtyards, ...PLACES, ...EXHIBITIONS, ...SHOPS, ...mine].filter(p => {
    if (p.type === 'cafe') return false;
    if (p.type === 'exhibition') return p.until && p.until >= todayStr();
    return true;
  });
}
function allCafes() {
  return [...CAFES, ...loadMine().filter(p => p.type === 'cafe')];
}

// ---------- Расстояния ----------
function distanceKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function walkMinutes(a, b) { return distanceKm(a, b) / WALK_SPEED_KMH * 60; }
function visitMinutes(p) { return VISIT_MINUTES[p.type] || 15; }

// ---------- Настройки (у каждого свои) ----------
function getUI() {
  const types = [...document.querySelectorAll('.types input:checked')].map(i => i.value);
  return {
    hours: Number(document.getElementById('hours').value),
    district: document.getElementById('district').value,
    types: types.length ? types : ['courtyard'],
    cuisine: document.getElementById('cuisine').value,
    minRating: Number(document.getElementById('minRating').value)
  };
}
function setUI(p) {
  if (p.hours) document.getElementById('hours').value = p.hours;
  if (p.district) document.getElementById('district').value = p.district;
  if (p.cuisine) document.getElementById('cuisine').value = p.cuisine;
  if (p.minRating !== undefined) document.getElementById('minRating').value = String(p.minRating);
  if (p.types) document.querySelectorAll('.types input').forEach(i => { i.checked = p.types.includes(i.value); });
}
function savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(getUI())); }
function loadPrefs() {
  try { const p = JSON.parse(localStorage.getItem(PREFS_KEY)); if (p) setUI(p); } catch (e) {}
}
document.querySelectorAll('.controls select, .types input').forEach(el => el.addEventListener('change', savePrefs));

// ---------- Еда ----------
async function findFoodNear(point, ui) {
  const mine = allCafes().filter(c => {
    if (ui.cuisine !== 'any' && c.cuisine && c.cuisine !== ui.cuisine) return false;
    if (ui.minRating && (!c.rating || c.rating < ui.minRating)) return false;
    return distanceKm(point, c) < 1.2;
  });

  let osm = [];
  try {
    const cuisineFilter = ui.cuisine === 'any' ? '' : (ui.cuisine === 'coffee_shop' ? '' : `["cuisine"~"${ui.cuisine}"]`);
    const amenity = ui.cuisine === 'coffee_shop' ? 'cafe' : 'cafe|restaurant';
    const q = `[out:json][timeout:10];node["amenity"~"${amenity}"]["name"]${cuisineFilter}(around:600,${point.lat},${point.lng});out 20;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) });
    const data = await res.json();
    osm = data.elements.map(e => ({
      id: 'osm' + e.id, name: e.tags.name, lat: e.lat, lng: e.lon,
      cuisine: e.tags.cuisine, note: e.tags.cuisine ? 'Кухня: ' + e.tags.cuisine : (e.tags.amenity === 'cafe' ? 'Кафе' : 'Ресторан')
    }));
  } catch (err) {}

  // Оценки есть только у ваших мест, у мест из OSM их нет
  const pool = ui.minRating ? mine : [...mine, ...osm];
  if (!pool.length) {
    const fallback = CAFES.slice().sort((p, q) => distanceKm(point, p) - distanceKm(point, q))[0];
    return { ...fallback, isFood: true, note: 'Запасное место: ничего подходящего рядом не найдено' };
  }
  pool.sort((p, q) => distanceKm(point, p) - distanceKm(point, q));
  return { ...pool[0], isFood: true };
}

// ---------- Построение маршрута ----------
function currentTod() {
  const month = new Date().getMonth() + 1;
  const h = new Date().getHours();
  const from = (month >= 11 || month <= 1) ? 9 : (month >= 5 && month <= 7 ? 6 : 8);
  const to = (month >= 11 || month <= 1) ? 16 : (month >= 5 && month <= 7 ? 22 : 18);
  return (h >= from && h < to) ? 'day' : 'evening';
}

function fitsNow(place, tod) {
  return place.best === 'any' || place.best === tod;
}
async function buildRoute(ui, randomMode) {
  const budget = ui.hours * 60 - MEAL_MINUTES;
  let pool = allPlaces().filter(p => ui.types.includes(p.type) && (ui.district === 'all' || p.district === ui.district));
  if (!pool.length) return [];
const todChoice = document.getElementById('tod').value;
  const tod = todChoice === 'auto' ? currentTod() : todChoice;
  if (tod !== 'any') {
    const fitting = pool.filter(p => fitsNow(p, tod));
    if (fitting.length >= 3) pool = fitting;
  }

  let current = pool[Math.floor(Math.random() * pool.length)];
  const route = [current];
  let used = visitMinutes(current);
  pool = pool.filter(p => p.id !== current.id);

  while (pool.length) {
    let next;
    if (randomMode) {
      const near = pool.filter(p => walkMinutes(current, p) < 35);
      const source = near.length ? near : pool;
      next = source[Math.floor(Math.random() * source.length)];
    } else {
      pool.sort((p, q) => walkMinutes(current, p) - walkMinutes(current, q));
      next = pool[0];
    }
    const cost = walkMinutes(current, next) + visitMinutes(next);
    if (used + cost > budget) break;
    route.push(next);
    used += cost;
    current = next;
    pool = pool.filter(p => p.id !== next.id);
  }

  route.push(await findFoodNear(current, ui));
  return route;
}

// ---------- Показ ----------
const TYPE_LABEL = { courtyard: 'Двор', park: 'Парк', exhibition: 'Выставка', museum: 'Музей', shop: 'Магазин' };

function render(route) {
  layer.clearLayers();
  const list = document.getElementById('stops');
  list.innerHTML = '';
  if (!route.length) {
    document.getElementById('summary').textContent = 'Подходящих мест не нашлось: смените район или типы мест.';
    return;
  }
  let walkTotal = 0, visitTotal = 0;

  route.forEach((stop, i) => {
    L.marker([stop.lat, stop.lng]).addTo(layer).bindPopup(stop.name);
    let walkInfo = '';
    if (i > 0) {
      const m = Math.round(walkMinutes(route[i - 1], stop));
      walkTotal += m;
      walkInfo = 'идти ' + m + ' мин';
    }
    visitTotal += stop.isFood ? MEAL_MINUTES : visitMinutes(stop);
    const label = stop.isFood ? '🍽 Поесть' : TYPE_LABEL[stop.type] || '';
    let badge = '';
    if (stop.type === 'exhibition' && stop.until) badge = ' <span class="badge">осталось ' + daysLeft(stop.until) + ' дн.</span>';
    const rating = stop.rating ? ' ★' + stop.rating : '';
    const li = document.createElement('li');
    li.innerHTML = '<b>' + label + ':</b> ' + stop.name + rating + badge + '<small>' + (stop.note || '') + ' ' + walkInfo + '</small>';
    list.appendChild(li);
  });

  L.polyline(route.map(s => [s.lat, s.lng]), { color: '#2b4c7e' }).addTo(layer);
  map.fitBounds(route.map(s => [s.lat, s.lng]), { padding: [30, 30] });
  const total = walkTotal + visitTotal;
  document.getElementById('summary').textContent =
    'Мест: ' + route.length + ', пешком ~' + walkTotal + ' мин, всего ~' + (total / 60).toFixed(1) + ' ч';
}

async function run(randomMode) {
  const buttons = document.querySelectorAll('.controls button');
  buttons.forEach(b => b.disabled = true);
  document.getElementById('summary').textContent = 'Строю маршрут...';
  currentRoute = await buildRoute(getUI(), randomMode);
  render(currentRoute);
  buttons.forEach(b => b.disabled = false);
}
document.getElementById('build').addEventListener('click', () => run(false));
document.getElementById('random').addEventListener('click', () => run(true));

// ---------- Общая ссылка ----------
function routeToLink(route) {
  const ui = getUI();
  const ids = route.filter(s => !s.isFood).map(s => s.id).join(',');
  const food = route.find(s => s.isFood);
  const params = new URLSearchParams({
    r: ids, t: ui.types.join(','), h: ui.hours, d: ui.district,
    f: food ? [food.name, food.lat, food.lng].join('|') : ''
  });
  return location.origin + location.pathname + '?' + params.toString();
}
function routeFromLink() {
  const q = new URLSearchParams(location.search);
  if (!q.get('r')) return null;
  const known = allPlaces();
  const route = q.get('r').split(',').map(id => known.find(p => String(p.id) === id)).filter(Boolean);
  const f = (q.get('f') || '').split('|');
  if (f.length === 3) route.push({ name: f[0], lat: Number(f[1]), lng: Number(f[2]), note: 'Место, где поесть', isFood: true });
  return route.length ? route : null;
}
document.getElementById('share').addEventListener('click', async () => {
  if (!currentRoute.length) return;
  const url = routeToLink(currentRoute);
  const text = 'Идём гулять! Открой маршрут:';
  if (navigator.share) await navigator.share({ title: 'Маршрут по Петербургу', text, url });
  else { await navigator.clipboard.writeText(text + ' ' + url); alert('Ссылка скопирована, отправь её другу'); }
});

// ---------- Добавление своих мест ----------
async function geocode(address) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent('Санкт-Петербург, ' + address);
  const res = await fetch(url, { headers: { 'Accept-Language': 'ru' } });
  const data = await res.json();
  if (!data.length) return null;
  return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
}

document.getElementById('saveNew').addEventListener('click', async () => {
  const status = document.getElementById('addStatus');
  const name = document.getElementById('newName').value.trim();
  const type = document.getElementById('newType').value;
  const address = document.getElementById('newAddress').value.trim();
  const until = document.getElementById('newUntil').value;
  if (!name || !address) { status.textContent = 'Нужны название и адрес'; return; }
  if (type === 'exhibition' && !until) { status.textContent = 'У выставки укажите дату окончания'; return; }
  status.textContent = 'Ищу адрес на карте...';
  let pos = null;
  try { pos = await geocode(address); } catch (e) {}
  if (!pos) { status.textContent = 'Адрес не нашёлся, попробуйте точнее'; return; }
  const rating = Number(document.getElementById('newRating').value) || undefined;
  const place = {
    id: 'my' + Date.now(), type, name, lat: pos.lat, lng: pos.lng, district: 'all',
    until: until || undefined, cuisine: document.getElementById('newCuisine').value.trim() || undefined,
    rating, note: address
  };
  const mine = loadMine();
  mine.push(place);
  saveMine(mine);
  status.textContent = 'Сохранено: ' + name;
  ['newName', 'newAddress', 'newUntil', 'newCuisine', 'newRating'].forEach(id => document.getElementById(id).value = '');
});

// ---------- Голосовой ввод ----------
document.getElementById('voice').addEventListener('click', () => {
  const status = document.getElementById('addStatus');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { status.textContent = 'Голосовой ввод не поддерживается в этом браузере, введите вручную'; return; }
  const rec = new SR();
  rec.lang = 'ru-RU';
  status.textContent = 'Говорите: название, потом адрес. Например: «Выставка Дали, Литейный 53»';
  rec.onresult = e => {
    const said = e.results[0][0].transcript;
    const parts = said.split(/[,.]\s*/);
    document.getElementById('newName').value = parts[0] || said;
    if (parts[1]) document.getElementById('newAddress').value = parts.slice(1).join(' ');
    const lower = said.toLowerCase();
    if (lower.includes('выставк')) document.getElementById('newType').value = 'exhibition';
    else if (lower.includes('парк') || lower.includes('сад')) document.getElementById('newType').value = 'park';
    else if (lower.includes('музе')) document.getElementById('newType').value = 'museum';
    else if (lower.includes('кафе') || lower.includes('ресторан')) document.getElementById('newType').value = 'cafe';
    status.textContent = 'Услышал: «' + said + '». Проверьте поля и нажмите «Сохранить».';
  };
  rec.onerror = () => { status.textContent = 'Не расслышал, попробуйте ещё раз'; };
  rec.start();
});
// ---------- Режим «Руины»: только осмотр снаружи ----------
const RULES_KEY = 'dvory-ruin-rules-v1';

function ruinsAllowedNow() {
  // Места нельзя предлагать в темноте, даже если пользователь выбрал вечер
  return currentTod() === 'day';
}

function acceptRules() {
  if (localStorage.getItem(RULES_KEY) === todayStr()) return true;
  const ok = confirm(
    'Перед поездкой к руинам:\n' +
    '• смотрим только снаружи, внутрь зданий не заходим\n' +
    '• не лезем через заборы и не заходим за ленту и таблички\n' +
    '• если закрыто или охраняется, едем в другое место\n' +
    '• не ходим в тёмное время и не расходимся\n\nВсё так?'
  );
  if (ok) localStorage.setItem(RULES_KEY, todayStr());
  return ok;
}

function pickRuin(maxDrive) {
  const mine = loadMine().filter(p => p.type === 'ruin');
  return [...RUINS, ...mine].filter(p =>
    p.driveMin <= maxDrive && p.access && !isBanned(p)
  );
}

document.getElementById('ruinTrip').addEventListener('click', () => {
  const box = document.getElementById('carResult');
  if (!ruinsAllowedNow()) {
    box.textContent = 'Сейчас темно или скоро стемнеет. К руинам едем только днём, без исключений. Попробуйте завтра утром.';
    return;
  }
  if (!acceptRules()) { box.textContent = 'Без подтверждения правил маршрут не показываю.'; return; }
  const maxDrive = Number(document.getElementById('maxDrive').value);
  const list = pickRuin(maxDrive);
  if (!list.length) {
    box.textContent = 'В такую дорогу подходящих руин нет. Поставьте 60 минут или добавьте своё место, у которого вы точно знаете, что вход свободный.';
    return;
  }
  const pick = list[Math.floor(Math.random() * list.length)];
  const accessText = pick.access === 'open'
    ? 'Источник пишет про свободный вход, но состояние здания могло измениться.'
    : 'Доступ не подтверждён: сначала узнайте, открыта ли территория.';
  box.innerHTML = '<b>' + pick.name + '</b><br>~' + pick.driveMin + ' мин от города (сверьте по навигатору)<br>'
    + '<small>' + (pick.note || '') + '</small><br>'
    + '<b>' + accessText + '</b><br>'
    + '<small>' + (pick.rule || '') + '</small><br>'
    + '<a href="https://www.openstreetmap.org/?mlat=' + pick.lat + '&mlon=' + pick.lng + '#map=14/' + pick.lat + '/' + pick.lng + '" target="_blank">Открыть на карте</a>';
});

// ---------- Запуск ----------
loadPrefs();
const sharedQuery = new URLSearchParams(location.search);
if (sharedQuery.get('t')) {
  setUI({ types: sharedQuery.get('t').split(','), hours: sharedQuery.get('h'), district: sharedQuery.get('d') });
}
const shared = routeFromLink();
if (async function start() {
  await updatePlaces();
  loadPrefs();
  const q = new URLSearchParams(location.search);
  if (q.get('t')) setUI({ types: q.get('t').split(','), hours: q.get('h'), district: q.get('d') });
  const shared = routeFromLink();
  if (shared) { currentRoute = shared; render(currentRoute); }
})();

// ---------- Журнал посещений и оценки (только на этом телефоне) ----------
const VISITS_KEY = 'dvory-visits-v1';
const ROUTES_KEY = 'dvory-routes-v1';
const NEAR_METERS = 150;

function loadVisits() {
  try { return JSON.parse(localStorage.getItem(VISITS_KEY)) || {}; } catch (e) { return {}; }
}
function saveVisit(placeId, data) {
  const all = loadVisits();
  all[placeId] = { ...(all[placeId] || {}), ...data, date: todayStr() };
  localStorage.setItem(VISITS_KEY, JSON.stringify(all));
}
function placeRating(placeId) {
  const v = loadVisits()[placeId];
  return v && v.rating ? v.rating : null;
}

// Места с вашей оценкой 2 и ниже больше не предлагаем
function isBanned(place) {
  const r = placeRating(place.id);
  return r !== null && r <= 2;
}

// ---------- Оценка маршрутов целиком ----------
function routeKey(route) {
  return route.filter(s => !s.isFood).map(s => s.id).sort().join(',');
}
function loadRoutes() {
  try { return JSON.parse(localStorage.getItem(ROUTES_KEY)) || {}; } catch (e) { return {}; }
}
function rateRoute(route, rating) {
  const all = loadRoutes();
  all[routeKey(route)] = { rating, date: todayStr() };
  localStorage.setItem(ROUTES_KEY, JSON.stringify(all));
}
// Доля общих мест с маршрутом, который вы оценили на 2 и ниже
function looksLikeBadRoute(route) {
  const mine = new Set(route.filter(s => !s.isFood).map(s => String(s.id)));
  const bad = Object.entries(loadRoutes()).filter(([, v]) => v.rating <= 2);
  return bad.some(([key]) => {
    const ids = key.split(',');
    const common = ids.filter(id => mine.has(id)).length;
    return ids.length > 0 && common / ids.length >= 0.6;
  });
}

// ---------- Кнопка «Были здесь» ----------
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no-geo'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

async function markVisited(stop, manual) {
  if (!manual) {
    try {
      const me = await getPosition();
      const meters = distanceKm(me, stop) * 1000;
      if (meters > NEAR_METERS) {
        alert('Вы в ' + Math.round(meters) + ' м от места. Подойдите ближе или отметьте вручную.');
        return false;
      }
    } catch (e) {
      alert('Не удалось определить место. Можно отметить вручную.');
      return false;
    }
  }
  const ratingText = prompt('Ваша оценка места от 1 до 5 (пусто, чтобы пропустить):');
  const rating = Number(ratingText);
  const data = {};
  if (rating >= 1 && rating <= 5) data.rating = rating;
  if (stop.type === 'shop') {
    const spend = Number(prompt('Сколько потратили, ₽ (пусто, чтобы пропустить):'));
    if (spend > 0) addSpend(stop.id, spend);
  }
  saveVisit(stop.id, data);
  return true;
}

function attachVisitButtons(route) {
  const items = document.querySelectorAll('#stops li');
  route.forEach((stop, i) => {
    if (stop.isFood || !items[i]) return;
    const done = loadVisits()[stop.id];
    const btn = document.createElement('button');
    btn.className = 'secondary small';
    btn.textContent = done ? 'Были ' + done.date + (done.rating ? ' ★' + done.rating : '') : 'Были здесь';
    btn.addEventListener('click', async () => {
      const ok = await markVisited(stop, false) || (confirm('Отметить вручную?') && await markVisited(stop, true));
      if (ok) render(currentRoute);
    });
    items[i].appendChild(btn);
  });

  // Оценка маршрута целиком
  const rate = document.createElement('button');
  rate.className = 'accent small';
  rate.textContent = 'Оценить весь маршрут';
  rate.addEventListener('click', () => {
    const r = Number(prompt('Оценка всего маршрута от 1 до 5:'));
    if (r >= 1 && r <= 5) { rateRoute(route, r); alert('Запомнил: такой маршрут оценён на ' + r); }
  });
  document.getElementById('stops').appendChild(rate);
}

// ---------- Режим «на машине» ----------
function currentSeason() {
  const m = new Date().getMonth() + 1;
  if (m === 12 || m <= 2) return 'winter';
  if (m <= 5) return 'spring';
  if (m <= 8) return 'summer';
  return 'autumn';
}
const SEASON_RU = { winter: 'зимой', spring: 'весной', summer: 'летом', autumn: 'осенью' };

document.getElementById('carTrip').addEventListener('click', () => {
  const choice = document.getElementById('season').value;
  const season = choice === 'auto' ? currentSeason() : choice;
  const maxDrive = Number(document.getElementById('maxDrive').value);
  const mine = loadMine().filter(p => p.type === 'nature');
  const list = [...NATURE, ...mine].filter(p => p.driveMin <= maxDrive && (p.seasons || []).includes(season) && !isBanned(p));
  const box = document.getElementById('carResult');
  if (!list.length) {
    box.textContent = 'В этот сезон и в такую дорогу ничего подходящего. Поставьте 60 минут или добавьте свои места через форму.';
    return;
  }
  const pick = list[Math.floor(Math.random() * list.length)];
  box.innerHTML = '<b>' + pick.name + '</b><br>~' + pick.driveMin + ' мин от города (сверьте по навигатору), лучше ' + SEASON_RU[season] + '.<br><small>' + (pick.note || '') + '</small><br>'
    + '<a href="https://www.openstreetmap.org/?mlat=' + pick.lat + '&mlon=' + pick.lng + '#map=13/' + pick.lat + '/' + pick.lng + '" target="_blank">Открыть на карте</a>';
  const done = loadVisits()[pick.id];
  if (done) box.innerHTML += '<br><small>Вы здесь уже были ' + done.date + (done.rating ? ', оценка ★' + done.rating : '') + '</small>';
});
const form = document.getElementById("lookupForm");
const input = document.getElementById("profileId");
const submitBtn = document.getElementById("submitBtn");
const feedback = document.getElementById("feedback");
const results = document.getElementById("results");
const profileCard = document.getElementById("profileCard");
const groupsContainer = document.getElementById("groups");
const rawJson = document.getElementById("rawJson");
const copyJsonBtn = document.getElementById("copyJsonBtn");

const API_BASE = "https://app.wall.tg/api/profile/";
const PUBLIC_PROXIES = [
  {
    name: "corsproxy.io",
    buildUrl: (targetUrl) => `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
  }
];

const browserSafeHeaders = {
  accept: "*/*"
};

const state = {
  lastResponse: null,
  lastProxyName: null
};

const labelMap = {
  id: "ID профиля",
  userId: "Telegram ID",
  firstName: "Имя",
  lastName: "Фамилия",
  username: "Username",
  photoUrl: "Фото",
  walletAddress: "Кошелек",
  accountDate: "Дата аккаунта",
  isVerified: "Верификация",
  isBanned: "Бан",
  isPremium: "Premium",
  premiumTier: "Тир",
  premiumUntil: "Premium до",
  followersCount: "Подписчики",
  followingCount: "Подписок",
  postsCount: "Посты",
  viewsCount: "Просмотры",
  giftsCount: "Подарки",
  refCode: "Рефкод",
  referrerId: "ID реферера",
  languageCode: "Язык",
  createdAt: "Создан",
  updatedAt: "Обновлен",
  lastSeenAt: "Последний онлайн"
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const id = input.value.trim();
  if (!id) {
    setFeedback("error", "Введите ID.");
    return;
  }

  setLoading(true);
  setFeedback("info", `Запрашиваю профиль ${id}...`);
  results.classList.add("hidden");

  try {
    const result = await fetchProfile(id);
    renderProfile(result.data);
    setFeedback("success", `Профиль ${id} успешно загружен через ${result.proxyName}.`);
  } catch (error) {
    const message = getReadableError(error);
    setFeedback("error", message);
  } finally {
    setLoading(false);
  }
});

copyJsonBtn.addEventListener("click", async () => {
  if (!state.lastResponse) {
    setFeedback("error", "Сначала загрузите профиль.");
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(state.lastResponse, null, 2));
    setFeedback("success", "JSON скопирован в буфер обмена.");
  } catch {
    setFeedback("error", "Не удалось скопировать JSON. Проверьте разрешение браузера.");
  }
});

async function fetchProfile(id) {
  const targetUrl = `${API_BASE}${encodeURIComponent(id)}`;
  const failures = [];

  for (const proxy of PUBLIC_PROXIES) {
    try {
      const data = await requestJson(proxy.buildUrl(targetUrl));
      state.lastProxyName = proxy.name;
      return { data, proxyName: proxy.name };
    } catch (error) {
      if (isProfileNotFoundError(error)) {
        throw error;
      }

      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${proxy.name}: ${reason}`);
    }
  }

  throw new Error(`Не удалось получить ответ через публичные CORS-прокси. ${failures.join(" | ")}`);
}

async function requestJson(url) {
  const response = await fetch(url, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    headers: browserSafeHeaders
  });

  const bodyText = await response.text();
  const body = tryParseJson(bodyText);

  if (!response.ok) {
    const reason =
      typeof body === "object" && body !== null
        ? body.message || body.error || JSON.stringify(body)
        : String(body || "пустой ответ");
    throw new Error(`HTTP ${response.status}: ${reason}`);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("API вернул неожиданный формат ответа.");
  }

  if (isMissingProfilePayload(body)) {
    throw createProfileNotFoundError();
  }

  return body;
}

function createProfileNotFoundError() {
  const error = new Error("Профиль с таким ID не найден в базе.");
  error.name = "ProfileNotFoundError";
  return error;
}

function isProfileNotFoundError(error) {
  return error instanceof Error && error.name === "ProfileNotFoundError";
}

function isMissingProfilePayload(payload) {
  const keys = Object.keys(payload);
  return keys.length === 1 && keys[0] === "userId";
}

function renderProfile(data) {
  state.lastResponse = data;
  results.classList.remove("hidden");

  renderTopCard(data);
  renderGroups(data);
  rawJson.textContent = JSON.stringify(data, null, 2);
}

function renderTopCard(data) {
  profileCard.textContent = "";

  const top = document.createElement("div");
  top.className = "profile-top";

  const avatar = document.createElement("div");
  avatar.className = "avatar";

  if (typeof data.photoUrl === "string" && isLikelyUrl(data.photoUrl)) {
    const img = document.createElement("img");
    img.src = data.photoUrl;
    img.alt = "Фото профиля";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      avatar.textContent = getInitials(data);
    });
    avatar.appendChild(img);
  } else {
    avatar.textContent = getInitials(data);
  }

  const identity = document.createElement("div");
  identity.className = "identity";

  const fullName = [data.firstName, data.lastName].filter(Boolean).join(" ").trim();
  const name = fullName || "Без имени";

  const nameEl = document.createElement("h2");
  nameEl.textContent = name;

  const usernameEl = document.createElement("div");
  usernameEl.className = "username";
  usernameEl.textContent = data.username ? `@${data.username}` : "Без username";

  const badges = document.createElement("div");
  badges.className = "badges";

  if (data.isVerified) {
    badges.appendChild(makeBadge("Верифицирован", "ok"));
  }
  if (data.isPremium) {
    const tier = data.premiumTier ? ` (${data.premiumTier})` : "";
    badges.appendChild(makeBadge(`Premium${tier}`, "neutral"));
  }
  if (data.isBanned) {
    badges.appendChild(makeBadge("Бан", "no"));
  }
  if (data.isAiAgent) {
    badges.appendChild(makeBadge("AI Agent", "neutral"));
  }
  if (typeof data.premiumIcon === "string" && data.premiumIcon.trim()) {
    badges.appendChild(makeBadge(`Иконка ${data.premiumIcon}`, "neutral"));
  }

  identity.append(nameEl, usernameEl, badges);
  top.append(avatar, identity);

  const metrics = document.createElement("div");
  metrics.className = "metrics";

  const metricList = [
    ["Уровень", data.level],
    ["Подписчики", data.followersCount],
    ["Подписок", data.followingCount],
    ["Посты", data.postsCount],
    ["Просмотры", data.viewsCount],
    ["Подарки", data.giftsCount]
  ];

  for (const [title, value] of metricList) {
    metrics.appendChild(makeMetric(title, value));
  }

  profileCard.append(top, metrics);
}

function renderGroups(data) {
  groupsContainer.textContent = "";

  const groups = buildGroups(data);
  groups.forEach((group, index) => {
    const card = document.createElement("article");
    card.className = "panel group-card reveal";
    card.style.setProperty("--delay", `${0.06 * (index + 1)}s`);

    const title = document.createElement("h3");
    title.textContent = group.title;

    const grid = document.createElement("div");
    grid.className = "kv-grid";

    group.entries.forEach(([key, value]) => {
      grid.appendChild(makeKvRow(key, value));
    });

    card.append(title, grid);
    groupsContainer.appendChild(card);
  });
}

function buildGroups(data) {
  const groups = [];
  const consumed = new Set();

  const take = (title, predicate) => {
    const entries = [];
    for (const [key, value] of Object.entries(data)) {
      if (consumed.has(key)) {
        continue;
      }
      if (predicate(key, value)) {
        consumed.add(key);
        entries.push([key, value]);
      }
    }
    if (entries.length) {
      groups.push({ title, entries });
    }
  };

  take("Основное", (key) =>
    ["id", "userId", "firstName", "lastName", "username", "photoUrl", "bio", "role", "languageCode", "accountDate", "accountYear"].includes(key)
  );

  take("Премиум и статус", (key) =>
    key.startsWith("premium") ||
    ["isPremium", "isVerified", "isBanned", "banReason", "banCount", "statusFlag", "isAiAgent"].includes(key)
  );

  take("Реферальная система", (key) =>
    key.startsWith("ref") || key.includes("referred") || key.includes("referrer")
  );

  take("Уведомления и приватность", (key) =>
    key.startsWith("notify") ||
    ["whoCanComment", "hideEarnings", "hideUsername", "dmPrice", "dmMode", "wallPostsMode"].includes(key)
  );

  take("Tips и TON", (key) =>
    key.startsWith("tip") || key.startsWith("tonTip") || key === "tonReceived"
  );

  take("AI", (key) =>
    key.startsWith("ai") || ["aiProvider", "aiPersona", "aiActiveUntil", "isAiAgent"].includes(key)
  );

  take("Активность", (key) =>
    ["followersCount", "followingCount", "postsCount", "viewsCount", "streakDays", "streakLastDate", "longestStreak", "lastSeenAt", "createdAt", "updatedAt", "totalSpentStars", "totalEarned", "creatorRank", "nextMilestone"].includes(
      key
    )
  );

  take("Остальные поля", () => true);

  return groups;
}

function makeKvRow(key, value) {
  const row = document.createElement("div");
  row.className = "kv-row";

  const keyEl = document.createElement("div");
  keyEl.className = "kv-key";
  keyEl.textContent = labelMap[key] || humanizeKey(key);

  const valueEl = document.createElement("div");
  valueEl.className = "kv-value";
  valueEl.appendChild(makeValueNode(key, value));

  row.append(keyEl, valueEl);
  return row;
}

function makeValueNode(key, value) {
  if (value === null || value === undefined || value === "") {
    const empty = document.createElement("span");
    empty.className = "value-empty";
    empty.textContent = "-";
    return empty;
  }

  if (typeof value === "boolean") {
    return makeBadge(value ? "Да" : "Нет", value ? "ok" : "no");
  }

  if (typeof value === "number") {
    const span = document.createElement("span");
    span.className = "value-mono";
    span.textContent = new Intl.NumberFormat("ru-RU").format(value);
    return span;
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      const empty = document.createElement("span");
      empty.className = "value-empty";
      empty.textContent = "пусто";
      return empty;
    }

    const chips = document.createElement("div");
    chips.className = "chips";

    value.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = formatPrimitive(item);
      chips.appendChild(chip);
    });

    return chips;
  }

  if (typeof value === "object") {
    const pre = document.createElement("pre");
    pre.className = "inline-json";
    pre.textContent = JSON.stringify(value, null, 2);
    return pre;
  }

  if (typeof value === "string") {
    if (isDateField(key, value)) {
      const dateWrap = document.createElement("div");
      dateWrap.className = "date-wrap";

      const local = document.createElement("time");
      local.dateTime = value;
      local.textContent = formatDate(value);

      const raw = document.createElement("span");
      raw.className = "date-raw";
      raw.textContent = value;

      dateWrap.append(local, raw);
      return dateWrap;
    }

    if (isLikelyUrl(value)) {
      const link = document.createElement("a");
      link.href = value;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "url";
      link.textContent = shortUrl(value);
      return link;
    }

    const text = document.createElement("span");
    text.textContent = value;

    if (/id|code|tier|mode|role|flag|username/i.test(key)) {
      text.className = "value-mono";
    }

    return text;
  }

  const fallback = document.createElement("span");
  fallback.textContent = String(value);
  return fallback;
}

function makeBadge(text, type) {
  const badge = document.createElement("span");
  badge.className = `badge ${type}`;
  badge.textContent = text;
  return badge;
}

function makeMetric(title, value) {
  const metric = document.createElement("div");
  metric.className = "metric";

  const metricTitle = document.createElement("div");
  metricTitle.className = "metric-title";
  metricTitle.textContent = title;

  const metricValue = document.createElement("div");
  metricValue.className = "metric-value";
  metricValue.textContent =
    typeof value === "number"
      ? new Intl.NumberFormat("ru-RU").format(value)
      : value === null || value === undefined
        ? "-"
        : String(value);

  metric.append(metricTitle, metricValue);
  return metric;
}

function humanizeKey(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.textContent = loading ? "Загрузка..." : "Загрузить";
}

function setFeedback(type, message) {
  feedback.className = `feedback ${type}`;
  feedback.textContent = message;
}

function getInitials(data) {
  const fullName = [data.firstName, data.lastName].filter(Boolean).join(" ").trim();
  const source = (fullName || data.username || "U").replace(/^@/, "");
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

function isLikelyUrl(value) {
  return /^https?:\/\//i.test(value);
}

function shortUrl(value) {
  try {
    const url = new URL(value);
    const shortPath = url.pathname.length > 24 ? `${url.pathname.slice(0, 24)}...` : url.pathname;
    return `${url.hostname}${shortPath}`;
  } catch {
    return value;
  }
}

function isDateField(key, value) {
  if (!/(at|date|until|deadline)$/i.test(key)) {
    return false;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function formatDate(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatPrimitive(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "number") {
    return new Intl.NumberFormat("ru-RU").format(value);
  }

  if (typeof value === "boolean") {
    return value ? "Да" : "Нет";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function tryParseJson(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getReadableError(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (/не найден в базе/i.test(message)) {
    return message;
  }

  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Запрос не выполнен. Публичные CORS-прокси недоступны или блокируют этот API.";
  }

  return `Ошибка: ${message}`;
}

/**
 * OSM opening_hours evaluation (Europe/London).
 * Empty / missing values default to open until 11 PM every day.
 */

const DEFAULT_CLOSE_MINUTES = 23 * 60; // 11 PM
const DAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_INDEX = Object.fromEntries(DAY_CODES.map((code, i) => [code, i]));

/**
 * Returns true if the pub has any interval tonight that runs past midnight
 * (i.e. the venue is open into the small hours of tomorrow morning).
 *
 * A pub qualifies when today's parsed rules contain an interval where:
 *   - end < start  (overnight=true, closes some time tomorrow), OR
 *   - end >= 24*60 (explicitly written as 24:00 or beyond)
 *
 * Falls back to false when opening_hours is empty (default is 11 PM).
 *
 * @param {string | null | undefined} openingHoursRaw
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isOpenPastMidnight(openingHoursRaw, now = new Date()) {
	const raw = typeof openingHoursRaw === 'string' ? openingHoursRaw.trim() : '';
	if (!raw) return false;

	const parsed = tryParseOpeningHours(raw);
	if (!parsed) return false;

	const { dayIndex } = getLondonTimeParts(now);
	const todayIntervals = parsed.get(dayIndex) || [];

	return todayIntervals.some((iv) => iv.overnight || iv.end >= 24 * 60);
}

/**
 * @param {string | null | undefined} openingHoursRaw
 * @param {Date} [now]
 * @returns {{ isOpen: boolean, statusText: string, usesDefault: boolean }}
 */
export function getOpeningStatus(openingHoursRaw, now = new Date()) {
	const raw = typeof openingHoursRaw === 'string' ? openingHoursRaw.trim() : '';
	if (!raw) {
		return evaluateDefault(now);
	}

	const parsed = tryParseOpeningHours(raw);
	if (!parsed) {
		return evaluateDefault(now);
	}

	const { dayIndex, minutes } = getLondonTimeParts(now);
	const active = findActiveInterval(parsed, dayIndex, minutes);

	if (active) {
		return {
			isOpen: true,
			statusText: `Open until ${formatMinutesLabel(active.end)}`,
			usesDefault: false,
		};
	}

	return { isOpen: false, statusText: 'Closed', usesDefault: false };
}

function evaluateDefault(now) {
	const { minutes } = getLondonTimeParts(now);
	const isOpen = minutes < DEFAULT_CLOSE_MINUTES;
	return {
		isOpen,
		statusText: isOpen ? `Open until ${formatMinutesLabel(DEFAULT_CLOSE_MINUTES)}` : 'Closed',
		usesDefault: true,
	};
}

/**
 * Normalise commas that act as rule separators into semicolons.
 *
 * A comma is a rule separator when it is:
 *   - preceded by a time token (HH:MM or HH:MM+)
 *   - followed (after optional whitespace) by a day-code (Mo/Tu/…/Su/PH)
 *
 * This does NOT touch commas inside day-lists ("Fr,Sa") or split-shift
 * windows ("11:30-14:30,17:00-22:00") because those are not preceded by a
 * time followed by a day-code.
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeRuleSeparators(s) {
	return s.replace(
		/(\d{1,2}:\d{2}\+?)\s*,\s*(?=(Mo|Tu|We|Th|Fr|Sa|Su|PH)[\s,;-])/gi,
		'$1; ',
	);
}

/**
 * @param {string} raw
 * @returns {Map<number, { start: number, end: number, overnight: boolean }[]> | null}
 */
function tryParseOpeningHours(raw) {
	const main = normalizeRuleSeparators(raw.split('||')[0].trim());
	if (!main) return null;

	if (/^(off|closed)$/i.test(main)) {
		return new Map();
	}

	/** @type {Map<number, { start: number, end: number, overnight: boolean }[]>} */
	const byDay = new Map();
	for (let d = 0; d < 7; d += 1) byDay.set(d, []);

	for (const piece of main.split(';')) {
		const segment = piece.trim();
		if (!segment) continue;
		parseSegment(segment, byDay);
	}

	return byDay;
}

/**
 * @param {string} segment
 * @param {Map<number, { start: number, end: number, overnight: boolean }[]>} byDay
 */
function parseSegment(segment, byDay) {
	if (/^(off|closed)$/i.test(segment)) return;

	const timeFirst = /^\d{1,2}:\d{2}/.test(segment);
	let dayPart = '';
	let timePart = segment;

	if (!timeFirst) {
		const split = segment.match(
			/^((?:PH|Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:PH|Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(.+)$/i,
		);
		if (!split) return;
		dayPart = split[1];
		timePart = split[2];
	}

	const days = dayPart ? expandDaySelector(dayPart) : [0, 1, 2, 3, 4, 5, 6];
	if (!days.length) return;

	if (/^off$/i.test(timePart.trim())) return;

	const intervals = parseTimePart(timePart);
	if (!intervals.length) return;

	for (const day of days) {
		const list = byDay.get(day) || [];
		list.push(...intervals);
		byDay.set(day, list);
	}
}

/**
 * @param {string} dayPart
 * @returns {number[]}
 */
function expandDaySelector(dayPart) {
	/** @type {Set<number>} */
	const out = new Set();

	for (const group of dayPart.split(',')) {
		const token = group.trim();
		if (!token || /^PH$/i.test(token)) continue;

		const range = token.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)$/i);
		if (range) {
			for (const d of expandDayRange(toDayCode(range[1]), toDayCode(range[2]))) out.add(d);
			continue;
		}

		const code = toDayCode(token);
		if (DAY_INDEX[code] != null) out.add(DAY_INDEX[code]);
	}

	return [...out].sort((a, b) => a - b);
}

/**
 * @param {string} code
 * @returns {string}
 */
function toDayCode(code) {
	return code.charAt(0).toUpperCase() + code.charAt(1).toLowerCase();
}

/**
 * @param {string} startCode
 * @param {string} endCode
 * @returns {number[]}
 */
function expandDayRange(startCode, endCode) {
	const start = DAY_INDEX[startCode];
	const end = DAY_INDEX[endCode];
	if (start == null || end == null) return [];

	if (start <= end) {
		return Array.from({ length: end - start + 1 }, (_, i) => start + i);
	}

	return [
		...Array.from({ length: 7 - start }, (_, i) => start + i),
		...Array.from({ length: end + 1 }, (_, i) => i),
	];
}

/**
 * @param {string} timePart
 * @returns {{ start: number, end: number, overnight: boolean }[]}
 */
function parseTimePart(timePart) {
	/** @type {{ start: number, end: number, overnight: boolean }[]} */
	const intervals = [];

	for (const piece of timePart.split(',')) {
		const part = piece.trim();
		if (!part || /^off$/i.test(part)) continue;

		const range = part.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
		if (range) {
			const start = parseClock(range[1]);
			const end = parseClock(range[2]);
			if (start == null || end == null) continue;
			intervals.push({
				start,
				end,
				overnight: end <= start && end < 24 * 60,
			});
			continue;
		}

		const openEnd = part.match(/^(\d{1,2}:\d{2})\+$/);
		if (openEnd) {
			const start = parseClock(openEnd[1]);
			if (start == null) continue;
			intervals.push({
				start,
				end: DEFAULT_CLOSE_MINUTES,
				overnight: false,
			});
		}
	}

	return intervals;
}

/**
 * @param {string} hhmm
 * @returns {number | null}
 */
function parseClock(hhmm) {
	const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
	if (!match) return null;
	const hours = Number(match[1]);
	const mins = Number(match[2]);
	if (!Number.isFinite(hours) || !Number.isFinite(mins) || mins > 59) return null;
	if (hours === 24 && mins === 0) return 24 * 60;
	if (hours > 24) return null;
	return hours * 60 + mins;
}

/**
 * @param {Map<number, { start: number, end: number, overnight: boolean }[]>} byDay
 * @param {number} dayIndex
 * @param {number} minutes
 * @returns {{ end: number } | null}
 */
function findActiveInterval(byDay, dayIndex, minutes) {
	const today = byDay.get(dayIndex) || [];
	for (const interval of today) {
		if (intervalCoversSameDay(interval, minutes)) {
			return { end: interval.end };
		}
	}

	const yesterday = (dayIndex + 6) % 7;
	const yIntervals = byDay.get(yesterday) || [];
	for (const interval of yIntervals) {
		if (interval.overnight && minutes < interval.end) {
			return { end: interval.end };
		}
	}

	return null;
}

/**
 * @param {{ start: number, end: number, overnight: boolean }} interval
 * @param {number} minutes
 */
function intervalCoversSameDay(interval, minutes) {
	const { start, end, overnight } = interval;
	if (!overnight) {
		if (end >= 24 * 60) return minutes >= start;
		return minutes >= start && minutes < end;
	}
	return minutes >= start;
}

/**
 * Return the last Sunday of a given UTC month as a UTC timestamp at 01:00.
 * Used for BST boundary calculation.
 *
 * @param {number} year
 * @param {number} month  0-indexed
 * @returns {number}  milliseconds since epoch
 */
function lastSundayAt1UTC(year, month) {
	// Start at the last day of the month
	const d = new Date(Date.UTC(year, month + 1, 0));
	// Step back to the previous Sunday (getUTCDay() 0 = Sunday)
	d.setUTCDate(d.getUTCDate() - d.getUTCDay());
	d.setUTCHours(1, 0, 0, 0);
	return d.getTime();
}

/**
 * UK UTC offset in minutes (0 = GMT, 60 = BST).
 * BST runs from last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC.
 *
 * @param {Date} date
 * @returns {number}
 */
function ukOffsetMinutes(date) {
	const year = date.getUTCFullYear();
	const bstStart = lastSundayAt1UTC(year, 2);  // March
	const bstEnd   = lastSundayAt1UTC(year, 9);  // October
	return date.getTime() >= bstStart && date.getTime() < bstEnd ? 60 : 0;
}

/**
 * @param {Date} date
 * @returns {{ dayIndex: number, minutes: number }}
 */
function getLondonTimeParts(date) {
	// Pure arithmetic — no Intl, works identically on Hermes, JSC and Node.
	const offsetMs = ukOffsetMinutes(date) * 60 * 1000;
	const londonMs = date.getTime() + offsetMs;
	const d = new Date(londonMs);

	// Use UTC getters because we manually shifted the clock above.
	const hour = d.getUTCHours();
	const minute = d.getUTCMinutes();

	// getUTCDay(): 0=Sun, 1=Mon, …, 6=Sat → convert to OSM: 0=Mo, …, 6=Su
	const dayIndex = (d.getUTCDay() + 6) % 7;

	return { dayIndex, minutes: hour * 60 + minute };
}

/**
 * @param {number} minutes
 * @returns {string}
 */
export function formatMinutesLabel(minutes) {
	if (minutes >= 24 * 60) return 'midnight';
	const h24 = Math.floor(minutes / 60) % 24;
	const mins = minutes % 60;
	const period = h24 >= 12 ? 'PM' : 'AM';
	let h12 = h24 % 12;
	if (h12 === 0) h12 = 12;
	if (mins === 0) return `${h12} ${period}`;
	return `${h12}:${String(mins).padStart(2, '0')} ${period}`;
}

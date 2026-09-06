function phonesMatch(p1, p2) {
  if (!p1 || !p2) return false;
  if (p1 === p2) return true;
  const d1 = String(p1).replace(/\D/g, '');
  const d2 = String(p2).replace(/\D/g, '');
  if (!d1 || !d2) return false;
  if (d1 === d2) return true;
  if (d1.endsWith(d2) || d2.endsWith(d1)) return true;
  const minLen = Math.min(d1.length, d2.length, 10);
  if (minLen >= 6) {
    return d1.slice(-minLen) === d2.slice(-minLen);
  }
  return false;
}

function normalizePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

function maskPhone(phone) {
  if (!phone) return '';
  const cleaned = normalizePhone(phone);
  if (cleaned.length < 5) return '••••' + cleaned;
  return `+${cleaned.slice(0, 2)} ••••• ••${cleaned.slice(-3)}`;
}

module.exports = {
  phonesMatch,
  normalizePhone,
  maskPhone
};

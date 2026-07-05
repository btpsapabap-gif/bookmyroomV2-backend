// Indian mobile numbers: +91 followed by a 10-digit number starting 6-9.
const INDIA_MOBILE_REGEX = /^\+91[6-9]\d{9}$/;

export function isValidIndianMobile(mobile) {
  return typeof mobile === 'string' && INDIA_MOBILE_REGEX.test(mobile);
}

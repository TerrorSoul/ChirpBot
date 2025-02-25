// utils/dmTracker.js
const DMRateLimits = new Map();
const MAX_DMS_PER_MINUTE = 3;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

export async function canSendDM(userId) {
  const now = Date.now();
  if (!DMRateLimits.has(userId)) {
    DMRateLimits.set(userId, {
      count: 1,
      firstMessage: now
    });
    return true;
  }
  
  const userLimit = DMRateLimits.get(userId);
  
  // Reset counter if window has expired
  if (now - userLimit.firstMessage > RATE_LIMIT_WINDOW) {
    userLimit.count = 1;
    userLimit.firstMessage = now;
    return true;
  }
  
  // Check if user has hit the rate limit
  if (userLimit.count >= MAX_DMS_PER_MINUTE) {
    return false;
  }
  
  // Increment counter
  userLimit.count++;
  return true;
}

// Clean up old entries
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of DMRateLimits.entries()) {
    if (now - data.firstMessage > RATE_LIMIT_WINDOW) {
      DMRateLimits.delete(userId);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
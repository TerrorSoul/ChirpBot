// utils/validation.js
export function validateCommandOptions(options) {
    if (!options) return true;
    
    for (const option of options.data || []) {
      // Validate string length
      if (typeof option.value === 'string') {
        if (option.value.length > 2000) return false; // Discord's limit
      }
      
      // Validate numbers
      if (typeof option.value === 'number') {
        if (!isFinite(option.value) || option.value < 0) return false;
      }
    }
    
    return true;
  }
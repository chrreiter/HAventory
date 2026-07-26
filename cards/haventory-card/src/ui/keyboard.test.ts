import { hasCommandKey, saveShortcutLabel } from './keyboard';

describe('hasCommandKey', () => {
  it('reads the modern platform hint first', () => {
    expect(hasCommandKey({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe(true);
    expect(hasCommandKey({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' })).toBe(false);
  });

  it('falls back to navigator.platform where userAgentData is absent', () => {
    expect(hasCommandKey({ platform: 'MacIntel' })).toBe(true);
    expect(hasCommandKey({ platform: 'Win32' })).toBe(false);
    expect(hasCommandKey({ platform: 'Linux x86_64' })).toBe(false);
    expect(hasCommandKey({ platform: 'Linux armv8l' })).toBe(false);
  });

  // iPadOS 13+ claims MacIntel, and that is the answer we want: a keyboard
  // attached to an iPad has a Command key.
  it('counts iOS and iPadOS as Apple', () => {
    expect(hasCommandKey({ platform: 'iPhone' })).toBe(true);
    expect(hasCommandKey({ platform: 'iPad' })).toBe(true);
    expect(hasCommandKey({ platform: 'MacIntel' })).toBe(true);
  });

  it('reads the user-agent string only when nothing else is reported', () => {
    expect(hasCommandKey({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe(true);
    expect(hasCommandKey({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(false);
  });

  // The point of the whole exercise: a card cannot see the hardware, so an
  // unreadable platform must not advertise a key that may not exist.
  it('assumes Ctrl when the platform cannot be determined', () => {
    expect(hasCommandKey({})).toBe(false);
    expect(hasCommandKey({ platform: '' })).toBe(false);
    expect(hasCommandKey({ userAgentData: {} })).toBe(false);
  });
});

describe('saveShortcutLabel', () => {
  it('writes the chord the way that keyboard prints it', () => {
    expect(saveShortcutLabel({ platform: 'MacIntel' })).toBe('⌘↵');
    expect(saveShortcutLabel({ platform: 'Win32' })).toBe('Ctrl+Enter');
    expect(saveShortcutLabel({})).toBe('Ctrl+Enter');
  });
});

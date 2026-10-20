import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('keeps custom font sizes next to colours (a size is not a colour)', () => {
    expect(cn('text-m-logo', 'text-fg-1')).toBe('text-m-logo text-fg-1');
    expect(cn('text-m-hero text-fg-2')).toBe('text-m-hero text-fg-2');
  });

  it('resolves conflicts within the custom scales', () => {
    expect(cn('rounded-bubble', 'rounded-md')).toBe('rounded-md');
    expect(cn('shadow-tabbar', 'shadow-none')).toBe('shadow-none');
    expect(cn('text-m-chat', 'text-body')).toBe('text-body');
  });
});

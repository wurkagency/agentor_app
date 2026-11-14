import { describe, expect, it } from 'vitest';
import {
  convertShortcodes,
  parseTemplate,
  renderTemplate,
  TemplateError,
  templateVariables,
} from '../src/templates.js';

const ctx = {
  order: {
    number: '10447',
    createdAt: '2026-10-18T22:30:00Z',
    total: 439500,
    note: '',
    billing: { name: 'Hans Weber', company: null },
    customer: { name: 'Hans Weber GmbH' },
    couponCodes: ['HØST', 'VIP'],
    meta: { ean: '5790000000000' },
  },
  line: { name: 'Racercykel Aero', sku: 'AERO-56' },
  connection: { id: 'c-1' },
};

describe('template engine', () => {
  it('fills variables and keeps text', () => {
    expect(renderTemplate('Ordre {order.number} · {line.name} ({line.sku})', ctx)).toBe(
      'Ordre 10447 · Racercykel Aero (AERO-56)',
    );
  });

  it('writes missing values as empty text and joins lists', () => {
    expect(renderTemplate('[{order.transactionId}]', ctx)).toBe('[]');
    expect(renderTemplate('{order.couponCodes}', ctx)).toBe('HØST, VIP');
    expect(renderTemplate('{order.customer}', ctx)).toBe('');
  });

  it('applies filters', () => {
    expect(renderTemplate('{order.billing.company|default:order.customer.name}', ctx)).toBe(
      'Hans Weber GmbH',
    );
    expect(renderTemplate('{order.note|default:"Ingen bemærkning"}', ctx)).toBe('Ingen bemærkning');
    // 22:30 UTC is the next day in Copenhagen.
    expect(renderTemplate('{order.createdAt|date:dd-MM-yyyy HH:mm}', ctx)).toBe('19-10-2026 00:30');
    expect(renderTemplate('{order.total|money} kr.', ctx)).toBe('4.395,00 kr.');
    expect(renderTemplate('{line.name|truncate:5|upper}', ctx)).toBe('RACER');
    expect(renderTemplate('{order.meta.ean}', ctx)).toBe('5790000000000');
  });

  it('writes literal braces with {{ and }}', () => {
    expect(renderTemplate('{{ref}} {order.number}', ctx)).toBe('{ref} 10447');
  });

  it('cuts or fails values longer than the field allows', () => {
    expect(renderTemplate('Ordre {order.number}', ctx, { maxLength: 5 })).toBe('Ordre');
    expect(() =>
      renderTemplate('Ordre {order.number}', ctx, { maxLength: 5, overflow: 'fail' }),
    ).toThrow(TemplateError);
  });

  it('rejects bad syntax, unknown filters and prototype paths', () => {
    expect(() => parseTemplate('Ordre {order.number')).toThrow(/missing }/);
    expect(() => parseTemplate('Ordre }')).toThrow(/unexpected }/);
    expect(() => parseTemplate('{order.number|shout}')).toThrow(/unknown filter/);
    expect(() => parseTemplate('{order.__proto__.x}')).toThrow(/invalid variable/);
    expect(() => parseTemplate('{constructor}')).toThrow(/invalid variable/);
    expect(() => parseTemplate('{line.name|truncate:x}')).toThrow(/truncate/);
    expect(renderTemplate('{order.toString}', ctx)).toBe('');
  });

  it('lists the variables a template reads, including fallbacks', () => {
    expect(
      templateVariables('{order.number} {order.billing.company|default:order.customer.name}'),
    ).toEqual(['order.number', 'order.billing.company', 'order.customer.name']);
  });

  it('converts shortcodes from earlier integrations', () => {
    expect(convertShortcodes('Ordre [order_number] / kreditnota [refund_number] {x}')).toBe(
      'Ordre {order.number} / kreditnota {creditNote.number} {{x}}',
    );
  });
});

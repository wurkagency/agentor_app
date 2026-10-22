/** Display name for a QuickPay card brand ("visa" → "Visa"). */
export function brandName(brand: string | null): string {
  if (!brand) return 'Kort';
  const b = brand.toLowerCase();
  if (b.includes('visa')) return 'Visa';
  if (b.includes('master')) return 'Mastercard';
  if (b.includes('dankort')) return 'Dankort';
  if (b.includes('amex') || b.includes('american')) return 'American Express';
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

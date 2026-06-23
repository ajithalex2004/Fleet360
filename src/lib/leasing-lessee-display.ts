type MaybeString = string | null | undefined;

type LesseeLike = {
  name?: MaybeString;
};

type InquiryLike = {
  customerName?: MaybeString;
  companyName?: MaybeString;
};

type QuotationLike = {
  lesseeId?: MaybeString;
  lesseeName?: MaybeString;
  lessee?: LesseeLike | null;
  inquiry?: InquiryLike | null;
};

function clean(value: MaybeString) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : '';
}

export function buildLesseeDisplayName(input: QuotationLike) {
  const directLesseeName = clean(input.lesseeName);
  if (directLesseeName) return directLesseeName;

  const relatedLesseeName = clean(input.lessee?.name);
  if (relatedLesseeName) return relatedLesseeName;

  const companyName = clean(input.inquiry?.companyName);
  const customerName = clean(input.inquiry?.customerName);
  if (companyName && customerName) return `${companyName} (${customerName})`;
  if (companyName) return companyName;
  if (customerName) return customerName;

  return clean(input.lesseeId);
}

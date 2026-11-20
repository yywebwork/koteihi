export const categories = ['住居費', '光熱費', '通信費', '保険', 'サブスク', '教育費', 'その他']
export const frequencies = { 1: '毎月', 2: '2か月ごと', 6: '6か月ごと', 12: '毎年' }

const key = 'koteihi'
const empty = () => ({ version: 1, expenses: [], methods: [], customCategories: [] })
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const name = value => typeof value === 'string' && value.trim() !== ''
export const expiryValid = value => typeof value === 'string' && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) && !value.startsWith('0000-')

function unique(records, valid) {
  const ids = new Set()
  return records.every(record => {
    if (!object(record) || !name(record.id) || !record.id.isWellFormed() || ids.has(record.id) || !valid(record)) return false
    ids.add(record.id)
    return true
  })
}

export function validate(data) {
  if (!object(data) || data.version !== 1 ||
      !['expenses', 'methods', 'customCategories'].every(field => Array.isArray(data[field]))) {
    throw new Error('バックアップの形式またはバージョンが正しくありません。')
  }

  const allCategories = new Set(categories)
  for (const category of data.customCategories) {
    if (!name(category) || category.trim() !== category || allCategories.has(category)) {
      throw new Error('カスタムカテゴリの内容が正しくありません。')
    }
    allCategories.add(category)
  }

  if (!unique(data.methods, method => name(method.name) &&
    (method.type === 'bank' || (method.type === 'card' &&
      expiryValid(method.expiry) && typeof method.updated === 'boolean')))) {
    throw new Error('支払い方法の内容が正しくありません。')
  }

  const methods = new Map(data.methods.map(method => [method.id, method]))
  if (!unique(data.expenses, expense => {
    const method = methods.get(expense.methodId)
    return name(expense.name) && allCategories.has(expense.category) &&
      (expense.amount === null || (Number.isSafeInteger(expense.amount) && expense.amount >= 0)) &&
      [1, 2, 6, 12].includes(expense.interval) &&
      (expense.methodId === null || method !== undefined) &&
      typeof expense.memo === 'string' && typeof expense.confirmed === 'boolean' &&
      (expense.confirmed || (method?.type === 'card' && method.updated))
  })) {
    throw new Error('固定費の内容または支払い方法との紐付けが正しくありません。')
  }

  // 保存対象を明示し、バックアップに含まれる未知の項目を引き継がない。
  return {
    version: 1,
    customCategories: [...data.customCategories],
    methods: data.methods.map(({ id, name, type, expiry, updated }) =>
      type === 'card' ? { id, name, type, expiry, updated } : { id, name, type }),
    expenses: data.expenses.map(({ id, name, category, amount, interval, methodId, memo, confirmed }) =>
      ({ id, name, category, amount, interval, methodId, memo, confirmed }))
  }
}

export const storage = {
  load() {
    const raw = localStorage.getItem(key)
    return raw === null ? empty() : validate(JSON.parse(raw))
  },
  save(data) {
    localStorage.setItem(key, JSON.stringify(validate(data)))
  },
  clear() {
    localStorage.removeItem(key)
    return empty()
  }
}

export function newId() {
  return globalThis.crypto.randomUUID?.() ??
    Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte =>
      byte.toString(16).padStart(2, '0')).join('')
}

export function cardStatus(method, date = new Date()) {
  if (method?.type !== 'card') return null
  const [year, month] = method.expiry.split('-').map(Number)
  const monthsLeft = (year - date.getFullYear()) * 12 + month - date.getMonth() - 1
  if (monthsLeft > 1) return { label: '有効期限内', tone: 'normal' }
  if (monthsLeft === 1) return { label: '注意・来月が有効期限', tone: 'caution' }
  return { label: monthsLeft === 0 ? '警告・今月が有効期限' : '警告・有効期限切れ', tone: 'danger' }
}

export function monthlyTotal(expenses) {
  // すべての支払い頻度で割り切れる12を使い、丸めは合計に対して一度だけ行う。
  const scaled = expenses.reduce((sum, expense) =>
    sum + BigInt(expense.amount ?? 0) * (12n / BigInt(expense.interval)), 0n)
  return (scaled + 6n) / 12n
}

export function renewCard(data, id, expiry) {
  return {
    ...data,
    methods: data.methods.map(method =>
      method.id === id ? { ...method, expiry, updated: true } : method),
    expenses: data.expenses.map(expense =>
      expense.methodId === id ? { ...expense, confirmed: false } : expense)
  }
}

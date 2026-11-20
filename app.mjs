import { categories, frequencies, storage, validate, newId, cardStatus, monthlyTotal, renewCard, expiryValid } from './data.mjs'

const screen = document.querySelector('#screen')
const dialog = document.querySelector('#dialog')
const number = new Intl.NumberFormat('ja-JP')
const yen = value => `${number.format(value)}円`
const storageNote = 'データはこのブラウザに保存されます。ブラウザのデータを消去すると失われるため、設定からバックアップを保存できます。'
const confirmationHelp = '「確認済み」は、サービス側で現在のカード情報が登録されていることを確認した状態です。自動で更新された場合も、サービス側で確認してください。新規登録や支払い先の変更時は確認済みとして登録されます。'
const filters = { category: '', method: '', sort: 'category' }
let data
let loadError = false

try {
  data = storage.load()
} catch {
  loadError = true
}

function el(tag, { text, className, ...attrs } = {}, ...children) {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  node.append(...children.filter(child => child != null))
  return node
}

const p = (text, className) => el('p', { text, className })
const heading = (text, tag = 'h2') => el(tag, { text })
const panel = (...children) => el('div', { className: 'panel' }, ...children)
const stack = (...children) => el('div', { className: 'stack section' }, ...children)
const actions = (...children) => el('div', { className: 'actions' }, ...children)
const link = (text, href, className = 'button') => el('a', { text, href, className })
const button = (text, click, className) => {
  const node = el('button', { text, type: 'button', className })
  node.addEventListener('click', click)
  return node
}
const expenseUrl = expense => '#expense/' + encodeURIComponent(expense.id)
const findMethod = id => data.methods.find(method => method.id === id)
const allCategories = () => [...categories, ...data.customCategories]
const badge = (method, warningsOnly = false) => {
  const status = cardStatus(method)
  if (!status || (warningsOnly && status.tone === 'normal')) return null
  return el('span', { className: 'badge ' + status.tone, text: status.label })
}

function page(title, action) {
  screen.append(el('div', { className: 'row' }, heading(title, 'h1'), action))
}

function openDialog(title, content, submit, submitLabel = '保存する') {
  const form = el('form', { className: 'stack', method: 'dialog' })
  const error = el('p', { role: 'alert', className: 'error', hidden: '' })
  const close = button(submit ? 'キャンセル' : '閉じる', () => dialog.close())
  form.append(el('h2', { id: 'dialog-title', text: title }), content, error,
    actions(close, submit ? el('button', { type: 'submit', text: submitLabel, className: 'primary' }) : null))
  form.addEventListener('submit', event => {
    event.preventDefault()
    try {
      submit(new FormData(form))
      dialog.close()
      render()
    } catch (failure) {
      error.textContent = failure.message
      error.hidden = false
    }
  })
  dialog.replaceChildren(form)
  dialog.showModal()
}

function save(next) {
  try {
    storage.save(next)
  } catch {
    throw new Error('データを保存できませんでした。ブラウザの保存設定や空き容量を確認してください。')
  }
  data = next
  loadError = false
}

function confirmAction(title, text, run, label) {
  openDialog(title, p(text), run, label)
}

function showHelp() {
  openDialog('確認済みとは？', p(confirmationHelp))
}

function options(select, entries, selected) {
  for (const [value, text] of entries) select.append(new Option(text, value))
  select.value = selected
}

function field(text, control) {
  return el('label', {}, text, control)
}

function getName(values, key = 'name') {
  const value = values.get(key).trim()
  if (!value) throw new Error('名前を入力してください。')
  return value
}

function expenseForm(expense) {
  const fields = document.querySelector('#expense-form').content.cloneNode(true)
  const control = name => fields.querySelector(`[name="${name}"]`)
  const category = control('category')
  const custom = control('customCategory')
  const method = control('methodId')
  const hint = fields.querySelector('.method-hint')
  const addingCategory = 'add-category'
  const categoryOptions = allCategories().map((name, index) => [String(index), name])
  options(category, [['', '選択してください'], ...categoryOptions, [addingCategory, '＋ 新しいカテゴリを追加']],
    expense ? String(allCategories().indexOf(expense.category)) : '')
  options(control('interval'), Object.entries(frequencies), expense?.interval ?? 1)
  options(method, [['', '未設定'], ...data.methods.map(item => [item.id, item.name])], expense?.methodId ?? '')
  control('name').value = expense?.name ?? ''
  control('amount').value = expense?.amount ?? ''
  control('memo').value = expense?.memo ?? ''

  category.addEventListener('change', () => {
    custom.closest('label').hidden = category.value !== addingCategory
    custom.required = category.value === addingCategory
  })
  method.addEventListener('change', () => {
    hint.hidden = !(findMethod(method.value)?.updated && method.value !== expense?.methodId)
  })

  openDialog(expense ? '固定費を編集' : '固定費を登録', fields, values => {
    const categoryValue = values.get('category')
    const isCustom = categoryValue === addingCategory
    const categoryName = isCustom ? getName(values, 'customCategory') : allCategories()[Number(categoryValue)]
    if (isCustom && allCategories().includes(categoryName)) throw new Error('同じ名前のカテゴリがすでにあります。')
    const methodId = values.get('methodId') || null
    const amount = values.get('amount')
    const item = {
      id: expense?.id ?? newId(),
      name: getName(values),
      category: categoryName,
      amount: amount === '' ? null : Number(amount),
      interval: Number(values.get('interval')),
      methodId,
      memo: values.get('memo'),
      confirmed: expense?.methodId === methodId ? expense.confirmed : true
    }
    save({
      ...data,
      customCategories: isCustom ? [...data.customCategories, categoryName] : data.customCategories,
      expenses: expense ? data.expenses.map(record => record.id === item.id ? item : record) : [...data.expenses, item]
    })
  })
}

function amountDetails(expense) {
  const amount = expense.amount === null ? '金額未入力' : yen(expense.amount)
  return [
    p(`${amount} ／ ${frequencies[expense.interval]}`),
    expense.interval !== 1 && expense.amount !== null
      ? p(`月額換算 約${yen(monthlyTotal([expense]))}`, 'muted') : null
  ]
}

function expenseDetails(expense) {
  screen.append(el('a', { className: 'expense-back', href: '#expenses' },
    el('span', { 'aria-hidden': 'true', text: '←' }), '固定費一覧へ'))
  page('固定費の詳細')

  if (!expense) {
    screen.append(stack(panel(p('固定費が見つかりません。'))))
    return
  }
  const method = findMethod(expense.methodId)
  const confirmation = expense.confirmed ? null :
    el('section', { className: 'confirmation-panel', 'aria-labelledby': 'expense-confirmation-title' },
      el('h3', { id: 'expense-confirmation-title', className: 'confirmation-panel-title' },
        el('span', { 'aria-hidden': 'true', text: '⚠' }), '支払い情報が未確認です'),
      p('サービス側で新しいカード情報が登録されていることを確認してください。'),
      confirmButton(expense, true))
  const management = el('div', { className: 'actions management-actions' },
    button('編集する', () => expenseForm(expense)),
    button('削除する', () => confirmAction('固定費を削除', `「${expense.name}」を削除しますか？`, () => {
      save({ ...data, expenses: data.expenses.filter(item => item.id !== expense.id) })
      location.hash = '#expenses'
    }, '削除する'), 'delete delete-outline'))

  screen.append(stack(panel(heading(expense.name), p(expense.category, 'muted'), ...amountDetails(expense),
    p('支払い方法　' + (method?.name ?? '未設定')), badge(method),
    expense.memo ? el('p', { text: expense.memo, className: 'memo' }) : null,
    confirmation, management)))
}

function expenseTable(expenses) {
  const columns = ['カテゴリ', '固定費名', '金額・支払い頻度', '支払い方法', '状態']
  const header = el('tr', { role: 'row' }, ...columns.map(text =>
    el('th', { text, scope: 'col', role: 'columnheader' })))

  const rows = expenses.map(item => {
    const method = findMethod(item.methodId)
    const detail = link(item.name, expenseUrl(item), 'expense-name-link')
    const cell = (name, ...children) => el('td', { className: 'expense-' + name, role: 'cell' }, ...children)
    const row = el('tr', { className: 'expense-row', role: 'row' },
      cell('category', item.category),
      cell('name', detail),
      cell('amount', ...amountDetails(item)),
      cell('method', method?.name ?? '支払い方法未設定'),
      cell('state', el('div', { className: 'expense-warnings' }, badge(method, true),
        !item.confirmed ? el('span', { className: 'badge caution', text: '支払い情報が未確認' }) : null)))
    row.addEventListener('click', event => {
      if (!event.target.closest('a') && !window.getSelection()?.toString()) detail.click()
    })
    return row
  })

  return el('table', { className: 'expense-table', role: 'table', 'aria-label': '固定費一覧' },
    el('thead', { role: 'rowgroup' }, header), el('tbody', { role: 'rowgroup' }, ...rows))
}

function expenseList() {
  page('固定費', button('＋ 固定費を登録', () => expenseForm(), 'primary'))
  const list = stack()
  const filterBar = el('div', { className: 'controls panel section' })
  function updateList() {
    const order = allCategories()
    const byName = (a, b) => a.name.localeCompare(b.name, 'ja')
    const sorters = {
      category: (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || byName(a, b),
      name: byName,
      amount: (a, b) => (b.amount ?? -1) - (a.amount ?? -1) || byName(a, b)
    }
    const results = data.expenses.filter(item =>
      (!filters.category || item.category === filters.category) &&
      (!filters.method || (item.methodId === null ? 'unset' : 'id:' + item.methodId) === filters.method)).sort(sorters[filters.sort])
    list.replaceChildren(results.length ? expenseTable(results) :
      panel(p(data.expenses.length ? '条件に一致する固定費がありません。' : '固定費はまだ登録されていません。')))
  }
  for (const [key, label, entries] of [
    ['sort', '並べ替え', [['category', 'カテゴリ順'], ['name', '名前順'], ['amount', '請求額の高い順']]],
    ['category', 'カテゴリ', [['', 'すべて'], ...allCategories().map(name => [name, name])]],
    ['method', '支払い方法', [['', 'すべて'], ['unset', '未設定'], ...data.methods.map(item => ['id:' + item.id, item.name])]]
  ]) {
    const select = el('select')
    options(select, entries, filters[key])
    filters[key] = select.value
    select.addEventListener('change', () => {
      filters[key] = select.value
      updateList()
    })
    filterBar.append(field(label, select))
  }
  screen.append(filterBar, list)
  updateList()
}

function expiryFields(value = '') {
  const [year = '', month = ''] = value.split('-')
  const yearInput = el('input', { name: 'expiryYear', inputmode: 'numeric', maxlength: '4',
    pattern: '[0-9]{4}', placeholder: '例 2028', required: '' })
  yearInput.value = year
  yearInput.addEventListener('input', () => {
    const digits = yearInput.value.replace(/[^0-9]/g, '').slice(0, 4)
    if (digits !== yearInput.value) yearInput.value = digits
  })
  const monthInput = el('select', { name: 'expiryMonth', required: '' })
  options(monthInput, [['', '選択してください'], ...Array.from({ length: 12 }, (_, index) => [
    String(index + 1).padStart(2, '0'), String(index + 1)
  ])], month)
  return el('div', { className: 'expiry-fields' },
    field('有効期限の年（西暦4桁）', yearInput), field('有効期限の月', monthInput))
}

function readExpiry(values) {
  const expiry = `${values.get('expiryYear')}-${values.get('expiryMonth')}`
  if (!expiryValid(expiry)) throw new Error('有効期限は西暦4桁と1〜12の月を入力してください。')
  return expiry
}

function methodForm(method) {
  const type = el('select', { name: 'type' })
  options(type, [['card', 'クレジットカード'], ['bank', '銀行口座']], method?.type ?? 'card')
  const name = el('input', { name: 'name', required: '', autofocus: '' })
  name.value = method?.name ?? ''
  const expiry = expiryFields(method?.expiry)
  function updateFields() {
    expiry.hidden = type.value !== 'card'
    for (const input of expiry.querySelectorAll('input, select')) input.disabled = expiry.hidden
  }
  type.addEventListener('change', updateFields)
  updateFields()
  openDialog(method ? '支払い方法を編集' : '支払い方法を追加',
    el('div', { className: 'stack' }, method ? null : field('種類', type), field('表示名称', name),
      expiry, p('カード番号、セキュリティコード、口座番号などは入力しないでください。', 'muted')),
    values => {
      const item = { id: method?.id ?? newId(), type: type.value, name: getName(values) }
      if (item.type === 'card') {
        item.expiry = readExpiry(values)
        item.updated = method?.updated ?? false
      }
      save({ ...data, methods: method ? data.methods.map(record => record.id === item.id ? item : record) : [...data.methods, item] })
    })
}

function renewalForm(method) {
  openDialog('カードを更新', el('div', { className: 'stack' }, heading(method.name, 'h3'),
    p('新しい有効期限を保存すると、このカードに紐付く固定費がすべて未確認になります。'),
    expiryFields()), values => {
    const expiry = readExpiry(values)
    if (expiry === method.expiry) throw new Error('現在とは異なる有効期限を入力してください。')
    save(renewCard(data, method.id, expiry))
  }, 'カードを更新する')
}

function confirmButton(expense, primary = false) {
  const control = button('確認済みにする', () =>
    confirmAction('支払い情報の確認', `「${expense.name}」のサービス側で現在のカード情報が登録されていることを確認しましたか？`, () => {
      save({ ...data, expenses: data.expenses.map(item =>
        item.id === expense.id ? { ...item, confirmed: true } : item) })
    }, '確認済みにする'), primary ? 'primary' : undefined)
  if (primary) control.prepend(el('span', { 'aria-hidden': 'true', text: '✓' }))
  return control
}

function linkedExpenses(method) {
  return data.expenses.filter(item => item.methodId === method.id)
}

function progress(method) {
  const linked = linkedExpenses(method)
  return `${linked.filter(item => item.confirmed).length}/${linked.length}件確認済み`
}

function confirmationProgress(method) {
  const help = button('', showHelp, 'help-link')
  help.setAttribute('aria-haspopup', 'dialog')
  help.append(el('span', { className: 'help-icon', 'aria-hidden': 'true', text: '?' }),
    el('span', { className: 'help-label', text: '確認済みとは' }))
  return actions(p(progress(method)), help)
}

function methodList() {
  page('支払い方法', button('＋ 支払い方法を追加', () => methodForm(), 'primary'))
  const list = stack()
  for (const [type, label] of [['card', 'クレジットカード'], ['bank', '銀行口座']]) {
    list.append(heading(label))
    const methods = data.methods.filter(method => method.type === type)
    if (!methods.length) list.append(panel(p('登録されていません。')))
    for (const method of methods) {
      const linked = linkedExpenses(method)
      const pending = linked.filter(item => !item.confirmed)
      const confirmation = pending.length
        ? el('section', { className: 'confirmation-panel', 'aria-label': '支払い情報が未確認です' },
          el('h4', { className: 'confirmation-panel-title' },
            el('span', { 'aria-hidden': 'true', text: '⚠' }), '支払い情報が未確認です'),
          confirmationProgress(method),
          ...pending.map(item => el('div', { className: 'method-confirmation-row' },
            p(item.name), confirmButton(item, true))))
        : method.updated ? confirmationProgress(method) : null
      list.append(panel(heading(method.name, 'h3'), method.expiry ? p('有効期限　' + method.expiry) : null,
        badge(method),
        confirmation,
        el('div', { className: 'actions management-actions' },
          button('編集する', () => methodForm(method)),
          method.type === 'card' ? button('カードを更新', () => renewalForm(method)) : null,
          button('削除する', () => {
            if (linked.length) {
              openDialog('支払い方法を削除できません', p('先に固定費でこの支払い方法を変更または解除してください。'))
              return
            }
            confirmAction('支払い方法を削除', `「${method.name}」を削除しますか？`, () => {
              save({ ...data, methods: data.methods.filter(item => item.id !== method.id) })
            }, '削除する')
          }, 'delete delete-outline'))))
    }
  }
  screen.append(list)
}

const expiringCards = () => data.methods.filter(method => {
  const status = cardStatus(method)
  return status && status.tone !== 'normal'
})

function noticeSection(cards, pending) {
  const pendingCards = data.methods.filter(method => pending.some(item => item.methodId === method.id))
  return el('section', { id: 'home-notifications', className: 'stack section',
    'aria-labelledby': 'notifications-heading', tabindex: '-1' },
    el('h2', { id: 'notifications-heading', text: '通知' }),
    ...(cards.length || pending.length ? [
      ...cards.map(method => panel(heading(method.name, 'h3'), badge(method),
        p('有効期限　' + method.expiry), link('支払い方法を開く', '#methods'))),
      ...pendingCards.map(method => panel(heading(method.name + 'の支払い情報を確認', 'h3'),
        confirmationProgress(method),
        ...pending.filter(item => item.methodId === method.id).map(item =>
          actions(p(item.name), confirmButton(item)))))
    ] : [panel(p('現在の通知はありません'))]))
}

function home() {
  page('ホーム')
  const missing = data.expenses.filter(item => item.amount === null).length
  const cards = expiringCards()
  const pending = data.expenses.filter(item => !item.confirmed)
  const noticeCount = cards.length + pending.length
  const metric = (label, count, href) => {
    const children = [p(label), el('strong', { text: number.format(count) + '件' })]
    return href ? el('a', { className: 'tile', href }, ...children) : panel(...children)
  }
  screen.append(stack(el('section', { className: 'panel hero' }, heading('月額換算の固定費合計'),
      p(yen(monthlyTotal(data.expenses)), 'total')),
    el('div', { className: 'metrics' },
      metric('通知', noticeCount, '#home-notifications'),
      metric('固定費', data.expenses.length, '#expenses'),
      metric('支払い方法', data.methods.length, '#methods'),
      missing ? metric('金額未入力', missing) : null),
    !data.expenses.length && !data.methods.length
      ? panel(heading('はじめて使う方へ'), p('支払い方法を登録してから、紐付けたい固定費を登録します。'),
        link('支払い方法を開く', '#methods'), p(storageNote, 'muted')) : null), noticeSection(cards, pending))
}

function exportBackup() {
  const date = new Date()
  const iso = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(value => String(value).padStart(2, '0')).join('-')
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const download = el('a', { href: url, download: `teikiharaicho-backup-${iso}.json` })
  download.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const counts = state => `固定費 ${state.expenses.length}件、支払い方法 ${state.methods.length}件、カスタムカテゴリ ${state.customCategories.length}件`

function backupControls() {
  const input = el('input', { type: 'file', accept: '.json,application/json', hidden: '' })
  const error = el('p', { className: 'error', role: 'alert', hidden: '' })
  input.addEventListener('change', async () => {
    const file = input.files[0]
    input.value = ''
    if (!file) return
    error.hidden = true
    try {
      const restored = validate(JSON.parse(await file.text()))
      if (!input.isConnected) return
      openDialog('バックアップから復元', el('div', { className: 'stack' },
        p(data ? '現在　' + counts(data) : '現在のデータ件数を読み取れません。'),
        p('取り込み後　' + counts(restored)),
        p('現在のデータをすべて取り込み後のデータに置き換えます。')),
      () => save(restored), '置き換える')
    } catch (failure) {
      error.textContent = failure instanceof SyntaxError ? 'JSONファイルを読み取れませんでした。' : failure.message
      error.hidden = false
    }
  })
  return panel(heading('JSONバックアップ'),
    actions(data ? button('エクスポート', exportBackup) : null, button('インポート', () => input.click())), input, error)
}

function settings() {
  page('設定')
  screen.append(stack(panel(heading('データの保存'), p(storageNote)), backupControls(),
    panel(heading('全データ削除'), p('固定費、支払い方法、カスタムカテゴリ、確認状態をすべて削除します。'),
      actions(button('全データを削除', () =>
        confirmAction('全データを削除', 'すべてのアプリデータを削除します。この操作は取り消せません。', () => {
          try {
            data = storage.clear()
          } catch {
            throw new Error('データを削除できませんでした。ブラウザの保存設定を確認してください。')
          }
          loadError = false
        }, '削除する'), 'delete')))))
}

function render() {
  const [route, id] = location.hash.slice(1).split('/')
  const current = route === 'expense' ? 'expenses' : route === 'home-notifications' || !route ? 'home' : route
  for (const nav of document.querySelectorAll('.navigation a, .settings-link')) {
    if (nav.hash === '#' + current) nav.setAttribute('aria-current', 'page')
    else nav.removeAttribute('aria-current')
  }
  screen.replaceChildren()
  if (loadError) {
    screen.append(p('保存データを読み込めませんでした。ブラウザの保存設定を確認するか、設定からバックアップを復元してください。', 'error'))
    if (route !== 'settings') {
      screen.append(link('設定を開く', '#settings'))
      return
    }
  }
  switch (route) {
    case 'expenses': expenseList(); break
    case 'expense': expenseDetails(data.expenses.find(item => encodeURIComponent(item.id) === id)); break
    case 'methods': methodList(); break
    case 'settings': settings(); break
    default: home()
  }
}

function scrollToRoute() {
  if (location.hash === '#home-notifications') {
    const section = document.querySelector('#home-notifications')
    if (section) {
      section.focus({ preventScroll: true })
      section.scrollIntoView({ block: 'start' })
    }
  } else {
    window.scrollTo(0, 0)
  }
}

window.addEventListener('hashchange', () => {
  if (dialog.open) dialog.close()
  render()
  scrollToRoute()
})
window.addEventListener('storage', event => {
  if (event.key !== null && event.key !== 'koteihi') return
  if (dialog.open) dialog.close()
  try {
    data = storage.load()
    loadError = false
  } catch {
    data = undefined
    loadError = true
  }
  render()
})
render()
if (location.hash === '#home-notifications') scrollToRoute()

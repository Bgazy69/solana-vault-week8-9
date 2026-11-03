# Simple Vault — практика Anchor

Учебный контракт на Anchor 0.31.1 (Solana). Сейчас он делает три вещи:

1. **Vault создан** — админ создаёт vault для SPL-токена. *(неделя 8)*
2. **У каждого пользователя своя «карточка»** — личный аккаунт (PDA) внутри vault. *(неделя 8)*
3. **Депозит и share-токены** — пользователь вносит токены и получает share-токены. *(неделя 9)*

Контракт будет дорабатываться (вывод, Raydium и т.д.), поэтому он намеренно небольшой.

---

## Что делает контракт

```
initialize_vault    создаёт VaultState PDA, vault token account и share mint
create_user_card    создаёт UserCard PDA — личную карточку пользователя в vault
deposit(amount)     переводит токены пользователя в vault → печатает ему shares
```

### `initialize_vault`

Вызывает админ (платит за аккаунты). Создаёт три аккаунта для выбранного `token_mint`:

| Аккаунт | Seeds | Что хранит |
|---|---|---|
| `vault_state` | `["vault", token_mint]` | admin, token_mint, адреса token account и share mint, `total_tokens`, `total_shares`, bump |
| `vault_token_account` | `["vault_tokens", token_mint]` | токен-аккаунт, владелец — vault PDA |
| `share_mint` | `["share_mint", token_mint]` | mint для shares (6 decimals), authority — vault PDA |

### `create_user_card`

Вызывает любой пользователь (платит за свою карточку). Создаёт `UserCard`:

| Поле | Описание |
|---|---|
| `vault` | к какому vault относится карточка |
| `owner` | владелец карточки |
| `deposited` | сколько токенов пользователь внёс всего |
| `shares` | сколько share-токенов он получил |
| `bump` | bump PDA |

Seeds: `["user_card", vault_state, user]` — поэтому у одного пользователя в одном vault
может быть **только одна** карточка. Повторный вызов завершится ошибкой.

### `deposit(amount)`

Пользователь вносит `amount` токенов и получает share-токены — «квитанции» с его долей в vault.
**Депозит возможен только после `create_user_card`** — без карточки инструкция вернёт ошибку.

Что происходит по шагам:

1. Считается, сколько shares положено пользователю.
2. Токены переводятся с токен-аккаунта пользователя в `vault_token_account`.
3. Vault печатает shares на share-аккаунт пользователя (подписывает сам vault PDA).
4. Обновляются `total_tokens` и `total_shares` в vault, а также `deposited` и `shares` в карточке.

**Формула shares:**

**Формула расчёта shares с комиссией 1%:**

```text
fee = amount / 100
net_amount = amount - fee

Первый депозит:
shares = net_amount

Последующие депозиты:
shares = net_amount × total_shares / total_tokens
```

**Пример:**

Пользователь A вносит 100 токенов:
- Комиссия: 1 токен.
- В Vault поступает 99 токенов.
- Пользователь получает 99 shares.

Пользователь B вносит 50 токенов:
- Комиссия: 0.5 токена.
- В Vault поступает 49.5 токена.
- Пользователь получает 49.5 shares.

**Итог:**
- В Vault хранится 148.5 токена.
- Выпущено 148.5 shares.
- Администратору перечислено 1.5 токена комиссии.
- Доля A — 66.67%.
- Доля B — 33.33%.

**Дополнительные ограничения:**
- `ZeroAmount` — депозит не может быть равен нулю.
- `DepositTooSmall` — минимальный депозит составляет 1 токен (для mint с 6 decimals).
- `VaultPaused` — депозит запрещён, если администратор остановил Vault.

Комиссия переводится на токен-аккаунт, контролируемый администратором. Для выпуска shares используется сумма депозита после вычета комиссии.

---

## Требования

| Инструмент | Версия | Установка |
|---|---|---|
| Rust | stable | https://rustup.rs |
| Solana CLI | 1.18+ | https://docs.solana.com/cli/install-solana-cli-tools |
| Anchor CLI | 0.31.1 | `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.31.1 && avm use 0.31.1` |
| Node.js | 18+ | https://nodejs.org |
| Yarn | any | `npm i -g yarn` |

Rust-зависимости (`anchor-lang`, `anchor-spl` 0.31.1) подтянутся сами при `anchor build`.
JS-зависимости (`@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, `mocha`, `chai`, `typescript`) — через `yarn install`.

---

## Быстрый старт

### 1. Установить зависимости

```bash
cd vault-simple
yarn install
```

### 2. Сбилдить контракт

```bash
anchor build
```

Если билдишь **первый раз** (новый keypair):

```bash
anchor keys sync   # обновит declare_id! в lib.rs и Anchor.toml
anchor build       # пересобрать с правильным ID
```

Артефакты в `target/deploy/`:
- `simple_vault.so` — программа
- `simple_vault-keypair.json` — keypair (не коммитить!)

### 3. Настроить Solana CLI на devnet

```bash
solana config set --url devnet
solana address     # твой публичный ключ — запомни его
solana balance
```

### 4. Пополнить кошелёк

Для деплоя нужно ~2 SOL.

```bash
solana airdrop 2   # может не сработать из-за rate limit
```

Если rate limit — используй faucet:
- https://faucet.solana.com (вставь свой адрес)

### 5. Задеплоить

```bash
anchor deploy --provider.cluster devnet
```

### 6. Запустить тесты

```bash
yarn test
```

Ожидаемый вывод:

```
✔ initialize_vault: vault создан
✔ create_user_card: у каждого пользователя своя карточка
✔ create_user_card: вторая карточка для того же пользователя — ошибка
✔ deposit: A вносит 100 токенов → получает 99 shares
✔ deposit: B вносит 50 токенов → получает 49.5 shares
✔ deposit: без карточки — ошибка
✔ deposit: сумма 0 — ошибка
✔ deposit: меньше 1 токена — ошибка
✔ admin pause: останавливает и возобновляет депозиты
✔ admin pause: депозит запрещён при paused=true
✔ admin pause: обычный пользователь не может остановить vault

11 passing
```

---

## Структура проекта

```
vault-simple/
├── programs/simple_vault/src/lib.rs   # контракт
├── tests/vault.ts                     # тесты
├── Anchor.toml
├── Cargo.toml
└── package.json
```

---

## Частые ошибки

| Ошибка | Причина | Решение |
|---|---|---|
| `Insufficient funds` при деплое | мало SOL | пополни кошелёк на devnet |
| `AccountNotInitialized` в тестах | программа не задеплоена или другой ID | `anchor keys sync` → `anchor build` → `anchor deploy` |
| `already in use` при `create_user_card` | у пользователя уже есть карточка | это ожидаемо, карточка одна на пользователя |
| `AccountNotInitialized` (`user_card`) при `deposit` | нет карточки | сначала вызови `create_user_card` |
| `ZeroAmount` | `amount = 0` | вноси сумму больше нуля |
| `SharesTooSmall` | депозит слишком мал относительно vault | увеличь сумму |
| `429 Too Many Requests` | лимит публичного devnet RPC | подожди или возьми свой RPC |

---

## Задания для практики

## Задания для практики

- [x] **Комиссия 1% на депозит.** Комиссия переводится на токен-аккаунт администратора, а shares начисляются за вычетом комиссии.
- [x] **Минимальный депозит — 1 токен.** Депозиты меньше установленного минимума отклоняются.
- [x] **Admin Pause.** Администратор может приостанавливать и возобновлять депозиты. Обычный пользователь не может изменять статус Vault.
- [ ] **Тестирование трёх пользователей.** Проверить распределение долей после депозитов трёх разных пользователей.

### Статус проекта

**Неделя 8:** создание Vault, PDA-аккаунтов и UserCard — выполнено.

**Неделя 9:** депозит, выпуск share-токенов, проверки ошибок — реализовано и протестировано.

**Неделя 10:** вывод токенов (`withdraw`) — пока не реализован.

---

## Devnet Deployment

Программа Simple Vault успешно развёрнута в Solana Devnet.

**Program ID:**
`7Az9761LH81iJeA9vkPmjEKB27rimnpKqSZBKEieHcuX`

**Network:** Solana Devnet

**Последняя транзакция деплоя:**

https://explorer.solana.com/tx/FNg1K7Zwk7DEpV37sGeYXNooe2FPR4cGgRkYS97WGdVDyjRYu3hseXLVzwrCYFpQTKshibhrbgD3GJn42WHkeFA?cluster=devnet

**Программа в Solana Explorer:**

https://explorer.solana.com/address/7Az9761LH81iJeA9vkPmjEKB27rimnpKqSZBKEieHcuX?cluster=devnet

### Week 9 — Deposit Transaction

Депозит успешно выполнен в сети Solana Devnet.

**Транзакция:**

https://explorer.solana.com/tx/2M93oQBdfi9hNfYyrqKrNVNvy3gRLvBtCFQdha4uAsXBcFzLpQ7zsYrH7jGwTSR8DTdb9hhweh5Gxxd1EuW5tDBx?cluster=devnet

**Результат депозита:**
- Пользователь внёс 100 токенов.
- Комиссия 1% составила 1 токен.
- В Vault поступило 99 токенов.
- Пользователь получил 99 share-токенов.

Транзакция подтверждает работу инструкции `deposit` и выпуск share-токенов.

### Результаты тестирования

Программа протестирована в Solana Devnet с помощью Anchor.

**Результат: 11 passing tests.**

Проверены создание Vault, создание UserCard PDA, депозиты, комиссия, минимальный депозит и управление Admin Pause.

---

## PDA Account Architecture

Simple Vault использует PDA (Program Derived Address) для управления аккаунтами без приватных ключей.

### Схема аккаунтов

```text
                    ADMIN
                      |
                      | initialize_vault
                      v
                +-------------+
                | VaultState  |
                |     PDA     |
                +-------------+
                 /     |     \
                /      |      \
               v       v       v
       +----------+ +----------+ +-----------+
       | Vault    | | Share    | | UserCard  |
       | Token    | | Mint     | | PDA       |
       | Account  | |          | |           |
       +----------+ +----------+ +-----------+
            ^           |             ^
            |           |             |
       SPL tokens    Share tokens   User data
            |           |             |
            +-----------+-------------+
                        |
                     USER A
                     USER B
                     USER C
```

### PDA Seeds

| Account | Seeds | Назначение |
|---|---|---|
| VaultState | `["vault", token_mint]` | Настройки Vault, admin, балансы, статус paused |
| Vault Token Account | `["vault_tokens", token_mint]` | Хранение депозитных токенов |
| Share Mint | `["share_mint", token_mint]` | Выпуск share-токенов |
| UserCard | `["user_card", vault_state, user]` | Индивидуальная карточка пользователя |

### Кто управляет аккаунтами?

- **Admin** — создаёт Vault и может включать или отключать депозиты.
- **Vault PDA** — контролирует токены в хранилище и выпуск share-токенов.
- **User** — подписывает собственные депозиты и управляет своей карточкой.
- **Token Program** — выполняет переводы SPL-токенов и выпуск share-токенов через CPI.

У каждого пользователя отдельный UserCard PDA. Один пользователь не может создать две карточки для одного Vault.
```

Бұл схема Vault-тың қалай құрылғанын және PDA аккаунттарының байланысын көрсетеді.

**Әзірге тек осы бөлімді қосып, Ctrl + S бас.**

Дайын болса, **«болды» деп жаз.** Келесі қадамда README-дегі депозит формуласын 1% комиссияға сәйкестендіреміз. 🚀
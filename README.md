# Simple Vault — практика Anchor

Учебный контракт на Anchor 0.31.1 (Solana). Проект включает Vault, депозит/вывод токенов и интеграцию с Raydium CLMM:

1. **Vault создан** — админ создаёт vault для SPL-токена. *(неделя 8)*
2. **У каждого пользователя своя «карточка»** — личный аккаунт (PDA) внутри vault. *(неделя 8)*
3. **Депозит и share-токены** — пользователь вносит токены и получает share-токены. *(неделя 9)*
4. **Вывод токенов** — пользователь сжигает shares и получает свою долю SPL-токенов. *(неделя 10)*

Контракт поддерживает депозит, вывод токенов и CPI-интеграцию с Raydium CLMM. Open Position, Collect Fees, Close Position и ручной Rebalance успешно проверены в Devnet.

---

## Что делает контракт

```
initialize_vault    создаёт VaultState PDA, vault token account и share mint
create_user_card    создаёт UserCard PDA — личную карточку пользователя в vault
deposit(amount)     переводит токены пользователя в vault → печатает ему shares
withdraw(shares)    сжигает shares и возвращает пользователю SPL-токены
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
cd vault-dev
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
✔ withdraw: A 10 shares қайтарады және токен алады

12 passing
```

---

## Структура проекта

```
vault-dev/
├── programs/simple_vault/src/lib.rs   # контракт
├── scripts/create-clmm-pool.ts  # Raydium CLMM (Week 11)
├── devnet-pool.json              # Devnet pool addresses
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

- [x] **Комиссия 1% на депозит.** Комиссия переводится на токен-аккаунт администратора, а shares начисляются за вычетом комиссии.
- [x] **Минимальный депозит — 1 токен.** Депозиты меньше установленного минимума отклоняются.
- [x] **Admin Pause.** Администратор может приостанавливать и возобновлять депозиты. Обычный пользователь не может изменять статус Vault.
- [ ] **Тестирование трёх пользователей.** Проверить распределение долей после депозитов трёх разных пользователей.


### Статус проекта

**Неделя 8:** создание Vault, PDA-аккаунтов и UserCard — выполнено.

**Неделя 9:** депозит, выпуск share-токенов, комиссия 1%, минимальный депозит и Admin Pause — реализовано и протестировано.

**Неделя 10:** Withdraw (Burn + Transfer) — реализован и протестирован в Solana Devnet. Все 12 тестов пройдены.

**Неделя 11:** Raydium CLMM Pool — созданы два SPL-токена, настроен пул с начальной ценой 1:1 и комиссией 0.25%. Пул успешно создан в Devnet, адреса сохранены в `devnet-pool.json`.

**Неделя 12:** реализована инструкция Swap CPI через Raydium CLMM; успешный swap в Devnet пока не подтверждён.

**Неделя 13:** Open Position, Collect Fees, Close Position и ручной Rebalance успешно выполнены в Devnet.

---

## Devnet Deployment

Программа Simple Vault успешно развёрнута в Solana Devnet.

**Program ID:**
`7Az9761LH81iJeA9vkPmjEKB27rimnpKqSZBKEieHcuX`

**Network:** Solana Devnet

**Последняя транзакция деплоя:**

https://explorer.solana.com/tx/4KGFfP6UkhsZKLRkAUp7iRTGGeX2vzYfHqA9KwoS5cosk3knMLmkEj3fTum57MezkQEyYYeSh4rtNBTxGbdSxyVp?cluster=devnet

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

**Результат: 12 passing tests.**

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

---

## Week 10 — Withdraw (CPI, Burn & Transfer)

### Мақсаты

10-аптада Vault-тан токендерді қайтарып алу функциясы жасалды.

8–9-аптада пайдаланушы Vault-қа токен салып, share-токендер алатын. Ал 10-аптада пайдаланушы share-токендерін қайтарып, Vault-тағы үлесіне сәйкес SPL-токендерін ала алады.

### Withdraw қалай жұмыс істейді?

1. Пайдаланушы қайтарғысы келетін share мөлшерін көрсетеді.
2. Бағдарлама пайдаланушыда жеткілікті share бар екенін тексереді.
3. Қайтарылатын SPL-токен мөлшері есептеледі.
4. Share-токендер `Burn` арқылы жойылады.
5. Vault PDA қолтаңбасымен SPL-токендер пайдаланушыға аударылады.
6. VaultState және UserCard баланстары жаңартылады.

### Withdraw формуласы

`amount = shares * total_tokens / total_shares`

Мысалы, Vault-та 148.5 токен және 148.5 share болса:

- Пайдаланушы 10 share қайтарады.
- 10 share жойылады.
- Пайдаланушы 10 SPL-токен алады.

### Қауіпсіздік тексерулері

- Нөлдік мөлшермен withdraw жасауға болмайды.
- Пайдаланушыда жеткілікті share болуы керек.
- Vault тоқтатылған (`paused = true`) кезде withdraw орындалмайды.
- Токендерді аудару үшін Vault PDA қолтаңбасы қолданылады.

### Тестілеу нәтижесі

Команда:

`anchor test --skip-deploy --provider.cluster devnet`

Нәтиже:

**12 passing (46s)**

Оның ішінде жаңа Withdraw тесті сәтті өтті:

`withdraw: A 10 shares қайтарады және токен алады`

Тест пайдаланушының SPL-токен балансы көбейгенін, share-токендері азайғанын және Vault-тағы жалпы share саны жаңарғанын тексерді.

### Solana Devnet

**Program ID:**

`7Az9761LH81iJeA9vkPmjEKB27rimnpKqSZBKEieHcuX`

**Week 10 Deploy TX:**

https://explorer.solana.com/tx/3UZZiwMwTPQuQqp97uL7a8CH1NyvqW5jaCgXcqECehkjJ9YHt9TSgv6GsULb6ezwNjDB9DrVrozgrdpQ7QRB5dm6?cluster=devnet

**Withdraw TX:**

https://explorer.solana.com/tx/2DB8hNDv5bWKpykVW2QMBWU1jPDeJUGBiuzXynPkE4wN13rNupGvDCceKZzqzbmApKxCzNojfhN5kRU2VCu6fdsd?cluster=devnet

### Қорытынды

10-аптада Withdraw функциясы іске асырылды. SPL Token Program арқылы Burn және Transfer операциялары орындалды. Бағдарлама Devnet-ке жарияланып, барлық 12 тест сәтті аяқталды.

---

## Week 11 — Raydium CLMM Pool (Devnet)

### Мақсаты

11-аптада Solana Devnet желісінде екі SPL-токен жасалып, Raydium платформасында CLMM (Concentrated Liquidity Market Maker) пулы құрылды.

### Орындалған жұмыстар

1. TOKEN_A және TOKEN_B атты екі тесттік SPL-токен жасалды.
2. Әр токеннен 1 000 000 дана шығарылды (decimals = 6).
3. Raydium SDK V2 арқылы CLMM пулы құрылды.
4. Бастапқы баға 1 TOKEN_A = 1 TOKEN_B болып орнатылды.
5. Пулдың комиссиясы 0.25% (tick spacing = 60).
6. Барлық адрестер `devnet-pool.json` файлына сақталды.

### Devnet нәтижелері

**TOKEN_A:**
`UtVqq5DZpoGX9USfdR6gFLvTKN5mCbssGH2VRfVDY97`

**TOKEN_B:**
`ptNKTKbfbqVY5JMVThP5BKN4piH5Q6UF1TqBAdbCsSe`

**Raydium CLMM Pool ID:**
`69hxXoRzyCtNb36DfXwC8RvdUABR4freaX4x7Da8AK2F`

**CLMM Program ID:**
`DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH`

**Network:** Solana Devnet

### Транзакция

[Pool Creation Transaction](https://explorer.solana.com/tx/sdkbvuyk9fmwrBNCCWRTaNKsi4BkJhSLyBmYoSzBC92MqWzQ3W28hcjwQvdkU6YWXBJWKmH29Vw5fmQY2wquDHH?cluster=devnet)

[Raydium CLMM Pool — Solana Explorer](https://explorer.solana.com/address/69hxXoRzyCtNb36DfXwC8RvdUABR4freaX4x7Da8AK2F?cluster=devnet)

### Іске қосу

```bash
yarn install
yarn create-pool
```

**Ескерту:** `yarn create-pool` әр іске қосылған сайын жаңа токендер мен пул жасауға әрекет жасайды. Сондықтан дайын пулды қайта құрудың қажеті жоқ.

### Тексеру нәтижесі

TypeScript тексерісі сәтті өтті:

```bash
yarn tsc --noEmit
```

Нәтиже: `Done in 9.52s.`

### Қорытынды

11-аптада екі тесттік SPL-токен және Raydium CLMM пулы сәтті жасалды. Пулдың адресі мен қажетті параметрлері `devnet-pool.json` файлына сақталды.

Бұл файл 12–13-апталардағы тапсырмаларда қолданылады.

---

## Week 12 — Raydium CLMM Swap CPI

### Мақсаты

Vault программасын Raydium CLMM пулымен CPI арқылы байланыстыру және токен айырбастау инструкциясын жасау.

### Орындалған жұмыстар

- `swap_raydium` инструкциясы Rust тілінде жазылды.
- Raydium CLMM `swap_v2` CPI шақыруы қосылды.
- Vault PDA арқылы қол қою механизмі қолданылды.
- Программа Anchor көмегімен компиляцияланды және Devnet-ке орналастырылды.

**Статус:** Swap CPI коды дайын, бірақ нақты swap транзакциясының сәтті орындалуы әлі расталмаған.

## Week 13 — Raydium CLMM Position Management

### Мақсаты

Vault арқылы Raydium CLMM позицияларын басқару: ашу, комиссия жинау, жабу және қайта теңгерімдеу.

### 1. Open Position

`open_raydium_position` инструкциясы Vault PDA атынан CLMM позициясын ашады.

- Бастапқы tick диапазоны: `-5040 → +5040`
- Бастапқы liquidity: `44894291`
- Position NFT Vault PDA бақылауында сақталады.

[Open Position TX](https://explorer.solana.com/tx/4Xe61CL9d9SG7NtFQSqsyxgMeR2oXhXMqu49uwrPHJ3vdrjBgQqnBmvXXetsxRoMgddj31crCNhQBSvAgYHRhb27?cluster=devnet)

### 2. Collect Fees

`collect_raydium_fees` инструкциясы Raydium `DecreaseLiquidityV2` CPI шақыруын `liquidity = 0` параметрімен орындайды.

- Devnet транзакциясы сәтті расталды.
- Position аккаунты сақталды.
- Liquidity `44894291` мәнінде қалғаны on-chain тексерілді.
- Нақты оң мөлшердегі комиссияның жиналғаны әзірге расталмаған.

[Collect Fees TX](https://explorer.solana.com/tx/5s3wf2EL1MdpyJR3t8bzj9UgQD7XJXJa5cXG5sThyjUa39o5ZyNhRhPPBDZBuqzqYxbFbGx8DrSJ7wKqPeDvF9Mg?cluster=devnet)

### 3. Close Position

`close_raydium_position` инструкциясы:

1. `DecreaseLiquidityV2` арқылы ликвидтілікті шығарады.
2. `ClosePosition` арқылы позицияны жабады.

[Close Position TX](https://explorer.solana.com/tx/5dSdD5kQ7wjSuc2VpDM38FMiW3qGCLUo3wF9fxTdFo4vxfWXzz9cWm2Ho1XnUSof1SkTbn2xKKD5zgsxLWB59nAb?cluster=devnet)

### 4. Rebalance

Rebalance қолмен екі транзакция арқылы орындалды: ескі позиция жабылып, жаңа диапазонмен позиция ашылды.

| Параметр | Бұрын | Кейін |
|---|---|---|
| Tick Lower | -5040 | -2520 |
| Tick Upper | +5040 | +2520 |
| Liquidity | 44894291 | 84474014 |
| Position | Closed | Open |

Жаңа позицияның tick және liquidity параметрлері Solana Devnet аккаунтынан оқылып, тексерілді.

[Rebalance Open TX](https://explorer.solana.com/tx/5WvebNzYAfxzgG4xwcmaZi1ffA2Xtox9Wmpe7HcXcA2Dtvjc34ahJXkkZPaSF9kCscDGvbZucgQ1kzFML2H2NJC8?cluster=devnet)

**Ескерту:** Бұл автоматты ребаланс емес, екі бөлек транзакция арқылы орындалған демонстрациялық процесс.

### Week 12–13 скрипттері

| Файл | Мақсаты |
|---|---|
| `scripts/open-position.ts` | CLMM позициясын ашу |
| `scripts/collect-fees.ts` | Комиссия жинау |
| `scripts/close-position.ts` | Позицияны жабу |
| `scripts/rebalance-open.ts` | Жаңа диапазонмен позиция ашу |
| `scripts/simulate-position.ts` | Позицияға қатысты симуляция |
| `programs/simple_vault/src/instructions/swap.rs` | Swap CPI |
| `programs/simple_vault/src/instructions/open_position.rs` | Open Position CPI |
| `programs/simple_vault/src/instructions/collect_fees.rs` | Collect Fees CPI |
| `programs/simple_vault/src/instructions/close_position.rs` | Close Position CPI |

### Devnet

**Vault Program ID:**

`7Az9761LH81iJeA9vkPmjEKB27rimnpKqSZBKEieHcuX`

**Raydium CLMM Pool:**

`69hxXoRzyCtNb36DfXwC8RvdUABR4freaX4x7Da8AK2F`

**Қорытынды:** Week 12–13 аясында Vault пен Raydium CLMM арасындағы CPI интеграциясы жасалды. Swap CPI инструкциясы іске асырылып, программа Devnet-ке орналастырылды. Open Position, Collect Fees CPI, Close Position және қолмен Rebalance операциялары Devnet желісінде сәтті орындалды.

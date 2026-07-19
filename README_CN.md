# Suno API Plus

基于 [gcui-art/suno-api](https://github.com/gcui-art/suno-api) 的增强版 Suno 音乐生成 API。

本仓库在原项目基础上增加了：**后台管理、多账号池、OpenAI 兼容接口鉴权、YesCaptcha / 2Captcha、Cookie 自动提取与浏览器插件**。

[English](./README.md) · [简体中文](./README_CN.md)

---

## 功能特性

- **Suno 音乐 API**：生成 / 自定义模式 / 续写 / 歌词 / 分轨
- **管理后台 `/admin`**：账号池、网页生成、验证码配置、接口密钥、歌曲列表
- **多账号池**：`basic` / `super` / `heavy` 分级，自动负载均衡与积分同步
- **OpenAI 兼容接口**
  - `GET /v1/models`
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
- **接口密钥**：`Authorization: Bearer <key>`，后台可生成 / 启停
- **打码服务**：YesCaptcha、2Captcha（Token 优先）
- **Cookie 获取**
  - `npm run get-cookie`（Playwright）
  - 浏览器扩展 `suno-cookie-extension`
  - 后台「添加账号」授权向导
- **Docker Compose 一键部署**

> 项目通过浏览器自动化调用 Suno 网页能力，仅建议学习与自用。请遵守 Suno 服务条款与当地法律。

---

## 一键 Docker 部署

### 1. 拉取代码

```bash
git clone https://github.com/ShowSnowBlood/suno-api-plus.git
cd suno-api-plus
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

最少修改：

```env
ADMIN_PASSWORD=你的后台密码
ACCOUNT_ENCRYPTION_KEY=一串足够长的随机密钥
CAPTCHA_PROVIDER=2captcha
TWOCAPTCHA_KEY=你的2Captcha密钥
# 或者使用 YesCaptcha：
# CAPTCHA_PROVIDER=yescaptcha
# YESCAPTCHA_KEY=你的YesCaptcha密钥
```

可选：

```env
API_KEY=sk-suno-自定义密钥
SUNO_COOKIE=...   # 若只用后台多账号池，可不填
```

### 3. 启动

```bash
mkdir -p data
docker compose build
docker compose up -d
```

访问：

| 地址 | 说明 |
|---|---|
| `https://suno.38-47-121-78.sslip.io/admin` | 当前线上管理后台 |
| `https://suno.38-47-121-78.sslip.io/docs` | 当前线上接口文档 |
| `https://suno.38-47-121-78.sslip.io/v1` | 当前线上 OpenAI Base URL |

后台登录密码 = `.env` 里的 `ADMIN_PASSWORD`。

默认 Compose 只监听 `127.0.0.1:3000`，生产环境必须通过 HTTPS
反向代理访问。搭建步骤见 [deploy/HTTPS.md](./deploy/HTTPS.md)。

---

## 本地开发运行

```bash
git clone https://github.com/ShowSnowBlood/suno-api-plus.git
cd suno-api-plus
cp .env.example .env
npm install
npx playwright install chromium
npm run dev
```

---

## 如何获取 Suno Cookie

### 方式 A：浏览器插件（推荐）

1. Chrome 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」选择 `suno-cookie-extension/`
   - 或使用 `public/suno-cookie-extension.zip`
4. 登录 [suno.com](https://suno.com)
5. 点插件提取 Cookie
6. 粘贴到后台「账号池」，或写入 `.env` 的 `SUNO_COOKIE`

### 方式 B：Playwright 自动提取

```bash
cd suno-cookie-extractor && npm install && cd ..
npm run get-cookie -- --save
# Google / Apple 登录或 2FA
npm run get-cookie -- --manual --save
npm run verify-cookie
```

### 方式 C：手动 DevTools

1. 打开 [suno.com/create](https://suno.com/create)
2. `F12` → Network → 刷新
3. 找带 `__clerk_api_version` / Clerk 的请求
4. 复制完整 Cookie

---

## 管理后台说明

地址：`/admin`

| 模块 | 作用 |
|---|---|
| 概览 | 积分、状态总览 |
| 账号池 | 多账号添加 / 校验 / 刷新配额 |
| 生成 | 网页端生成音乐 |
| 验证码 | YesCaptcha / 2Captcha 密钥与模式 |
| 接口密钥 | 配置 `/v1/*` 访问密钥 |
| 接口文档 | 跳转 `/docs` |

账号可设置池级别：`basic` / `super` / `heavy`。

---

## OpenAI 兼容调用（sub2api 可用）

### Base URL

```text
https://<你的域名>/v1
```

当前线上地址：`https://suno.38-47-121-78.sslip.io/v1`

### 鉴权

后台启用密钥后：

```http
Authorization: Bearer sk-suno-xxxxxxxx
```

也支持：

```http
x-api-key: sk-suno-xxxxxxxx
```

### 示例

```bash
# 模型列表
export SUNO_BASE_URL=https://suno.38-47-121-78.sslip.io/v1

curl "$SUNO_BASE_URL/models" \
  -H "Authorization: Bearer $API_KEY"

# 生成音乐（chat completions）
curl "$SUNO_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "suno-music",
    "messages": [
      {"role": "user", "content": "一首深夜电子城市氛围的纯音乐"}
    ],
    "make_instrumental": true
  }'
```

### 可用模型

调用 `GET /v1/models` 可以自动发现当前实例暴露的模型。接口返回
OpenAI 兼容的 `list` 格式；后台启用接口密钥后，需要使用与生成接口相同的
API Key 鉴权。

模型实际可用性取决于所选 Suno 账号的套餐和上游权限。即使模型出现在目录中，
账号未获得对应版本权限时，上游仍可能拒绝生成请求。

| 模型 ID | 状态 | 上游模型 | 说明 |
|---|---|---|---|
| `suno-music` | 当前 / 推荐 | `chirp-fenix` | 最新支持模型的默认别名，当前对应 Suno V5.5；sub2api 和通用 OpenAI 客户端建议使用此值。 |
| `suno-v5.5` | 当前 | `chirp-fenix` | 明确指定 Suno V5.5。 |
| `suno-v5` | 稳定 | `chirp-crow` | Suno V5 模型 ID。 |
| `suno-v4.5+` | 稳定 | `chirp-bluejay` | Suno V4.5+ 模型 ID。 |
| `suno-v4.5` | 稳定 | `chirp-auk` | Suno V4.5 模型 ID。 |
| `suno-v4` | 旧版 | `chirp-v4` | Suno V4 兼容模型 ID。 |
| `suno-v3.5` | 旧版 | `chirp-v3-5` | Suno V3.5 兼容模型 ID。 |
| `suno-v3` | 旧版 | `chirp-v3-0` | Suno V3 兼容模型 ID。 |

获取模型列表示例：

```bash
curl "$SUNO_BASE_URL/models" \
  -H "Authorization: Bearer $API_KEY"
```

`data` 中每个条目包含 OpenAI 标准字段（`id`、`object`、`created`、
`owned_by`），并额外提供 `capabilities` 和 `metadata`，其中包含上游模型、
显示名称、状态、推荐标记以及可选的别名目标。
原始 `chirp-*` 上游标识仍支持透传，但下游集成建议使用上表中的公开
`suno-*` 模型 ID。

### sub2api / 第三方客户端

| 配置项 | 值 |
|---|---|
| API Base | `https://suno.38-47-121-78.sslip.io/v1` |
| API Key | 后台「接口密钥」里生成的 key |
| 模型 | `suno-music` |

可选池选择请求头：

```http
x-suno-pool: basic
```

---

## 原生接口

Swagger：`/docs`

常用：

- `POST /api/generate`
- `POST /api/custom_generate`
- `POST /api/extend_audio`
- `POST /api/generate_lyrics`
- `GET /api/get?ids=...`
- `GET /api/get_limit`

---

## 环境变量一览

| 变量 | 必填 | 说明 |
|---|---|---|
| `ADMIN_PASSWORD` | 是 | 后台密码 |
| `ACCOUNT_ENCRYPTION_KEY` | 是 | 加密存储账号 Cookie |
| `CAPTCHA_PROVIDER` | 建议 | `2captcha` 或 `yescaptcha` |
| `TWOCAPTCHA_KEY` | 使用 2captcha 时 | 2Captcha 密钥 |
| `YESCAPTCHA_KEY` | 使用 yescaptcha 时 | YesCaptcha 密钥 |
| `YESCAPTCHA_BASE_URL` | 否 | 默认官方地址 |
| `CAPTCHA_MODE` | 否 | `auto` / `token` / `click` |
| `SUNO_COOKIE` | 否 | 单账号默认 Cookie |
| `API_KEY` / `SUNO_API_KEY` | 否 | 保护 `/v1/*` |
| `ACCOUNT_DATA_PATH` | 否 | 默认 `/app/data/accounts.json` |
| `ACCOUNT_QUOTA_SYNC_INTERVAL_SEC` | 否 | 默认 300 秒 |
| `BROWSER` | 否 | 推荐 `chromium` |
| `BROWSER_HEADLESS` | 否 | 默认 true |
| `BROWSER_DISABLE_GPU` | 否 | Docker 建议 true |

验证码与接口密钥也可在后台保存，文件位于 `./data/`。

---

## 目录结构

```text
src/
  app/admin/           # 管理后台
  app/api/             # 原生接口 + 管理接口
  app/v1/              # OpenAI 兼容接口
  lib/                 # 账号池 / 打码 / 鉴权 / Suno 客户端
suno-cookie-extractor/ # Cookie 提取 CLI
suno-cookie-extension/ # 浏览器插件源码
public/                # 静态资源与插件 zip
docker-compose.yml
Dockerfile
.env.example
```

---

## 验证码说明

Suno 常触发 hCaptcha，需要付费打码：

- [2Captcha](https://2captcha.com)
- [YesCaptcha](https://yescaptcha.com)（文档：[YesCaptcha Wiki](https://yescaptcha.atlassian.net/wiki/spaces/YESCAPTCHA/overview)）

建议：

1. 在后台「验证码」页配置密钥，或写在 `.env`
2. 优先 Token 模式 / `auto`
3. 控制并发，避免账号异常

---

## 安全建议

- 公网部署前务必修改 `ADMIN_PASSWORD`、`ACCOUNT_ENCRYPTION_KEY`
- 给 `/v1/*` 配置 `API_KEY`
- 不要提交 `.env` 和 `data/`
- 生产环境建议 Nginx/Caddy + HTTPS
- 可用防火墙限制访问来源

---

## 更新升级

```bash
git pull
docker compose build
docker compose up -d
```

数据在 `./data`：账号、验证码配置、接口密钥等。

---

## 常见问题

**Q: sub2api 连不上？**  
A: Base URL 必须带 `/v1`，并填后台生成的接口密钥。

**Q: 积分不更新？**  
A: 后台账号池点刷新；生成成功后也会同步配额。

**Q: 生成一直卡验证码？**  
A: 检查 2Captcha/YesCaptcha 余额与密钥；看后台验证码面板是否启用。

**Q: 管理后台进不去？**  
A: 确认 `ADMIN_PASSWORD`，必要时重启容器。

---

## 免责声明

非官方项目，与 Suno, Inc. 无关。请自行承担使用风险，并遵守相关服务条款与法律。

## License

LGPL-3.0-or-later（与上游一致）

## 致谢

- 上游项目：[gcui-art/suno-api](https://github.com/gcui-art/suno-api)
- 本仓库增强：多账号后台、YesCaptcha、接口密钥、Cookie 工具与部署体验

# 组员开发与自动部署流程

## 一、本地运行项目（带 MiniMax API Key）

### 1. 下载项目

```cmd
git clone https://github.com/youzi-er/immersive-multimodal-reader.git
cd immersive-multimodal-reader
npm install
```

### 2. 创建本地 `.env`

在项目根目录新建文件：

```text
.env
```

内容：

```env
MINIMAX_API_KEY=你的 MiniMax API Key
MINIMAX_API_BASE=https://api.minimaxi.com
MINIMAX_TEXT_MODEL=MiniMax-M3
MINIMAX_TTS_MODEL=speech-2.8-hd
MINIMAX_IMAGE_MODEL=image-01
MINIMAX_DEFAULT_VOICE_ID=Chinese (Mandarin)_Lyrical_Voice
```

注意：

```text
.env 不要提交 GitHub
.env 不要发群里
API Key 不要写进代码
```

### 3. 本地运行

```cmd
npm run dev
```

打开：

```text
http://localhost:5173
```

后端接口：

```text
http://localhost:3001/api/health
```

### 4. 本地测试 MiniMax 功能

网页里测试：

```text
案情助手
对白播放
生成场景图
```

如果 AI 功能不能用，先检查：

```text
.env 是否在项目根目录
MINIMAX_API_KEY 是否正确
npm run dev 是否重新启动过
```

---

## 二、不同更改上自己的分支

### 1. 每次开发前更新 main

```cmd
git checkout main
git pull
```

### 2. 新建自己的功能分支

格式：

```cmd
git checkout -b feature/功能名
```

例如：

```cmd
git checkout -b feature/prompts
git checkout -b feature/reader-ui
git checkout -b feature/tts
git checkout -b feature/image-generation
git checkout -b feature/book-data
```

### 3. 推荐分支对应任务

```text
feature/prompts            prompt 优化
feature/reader-ui          前端 UI、样式、交互
feature/tts                语音合成、角色音色、音频播放
feature/image-generation   文生图、场景图展示
feature/book-data          原文解析、章节、线索、背包
feature/backend            后端接口、数据结构
feature/deploy             部署配置、CI/CD
```

### 4. 在分支上开发

运行项目：

```cmd
npm run dev
```

浏览器查看：

```text
http://localhost:5173
```

这个页面是你自己分支的效果，不影响线上网站。

### 5. 开发完成后检查

```cmd
npm run build
git status
```

确认不要提交：

```text
.env
node_modules/
frontend/dist/
*.log
*.tar.gz
*.tgz
服务器密码
API Key
SSH 私钥
```

### 6. 提交到自己的分支

```cmd
git add .
git commit -m "说明本次改动"
git push -u origin feature/功能名
```

例子：

```cmd
git add .
git commit -m "Update image generation prompt"
git push -u origin feature/prompts
```

如果这个分支之前已经推送过，后面直接：

```cmd
git push
```

---

## 三、合并到 main 并自动部署

### 1. 在 GitHub 开 Pull Request

进入 GitHub 仓库页面。

点击：

```text
Compare & pull request
```

选择：

```text
feature/功能名 -> main
```

### 2. PR 内容写清楚

标题示例：

```text
Update MiniMax image prompt
```

描述示例：

```text
改动内容：
- 优化文生图 prompt
- 增加负面词
- 调整场景图生成逻辑

测试：
- npm run build 通过
- 本地 http://localhost:5173 测试通过
```

### 3. 合并 PR

确认没问题后，点击：

```text
Merge pull request
```

合并到：

```text
main
```

### 4. 自动部署

只要 `main` 更新，GitHub Actions 会自动部署：

```text
main 更新
↓
GitHub Actions
↓
自动构建
↓
自动上传腾讯云
↓
自动重启后端
↓
线上网站更新
```

查看部署状态：

```text
GitHub -> Actions -> Deploy to Tencent Cloud
```

状态含义：

```text
绿色：部署成功
红色：部署失败
黄色：正在部署
```

### 5. 部署成功后查看网站

```text
http://124.223.192.167
```

---

## 四、如果 main 更新了，自己的分支怎么同步

如果别人已经合并了新代码到 main，你的分支要同步：

```cmd
git checkout main
git pull
git checkout feature/你的功能名
git merge main
```

如果出现冲突，不要乱删，先找负责人处理。

---

## 五、最短流程总结

### 本地运行

```cmd
git clone https://github.com/youzi-er/immersive-multimodal-reader.git
cd immersive-multimodal-reader
npm install
# 新建 .env
npm run dev
```

### 分支开发

```cmd
git checkout main
git pull
git checkout -b feature/功能名
npm run dev
npm run build
git add .
git commit -m "说明改动"
git push -u origin feature/功能名
```

### 合并上线

```text
GitHub 开 PR
↓
合并到 main
↓
GitHub Actions 自动部署
↓
http://124.223.192.167 更新
```


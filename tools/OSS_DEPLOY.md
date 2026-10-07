# 阿里云资源发布

目前网页入口仍是 GitHub Pages。此工具准备图片、视频、字体、CSS 和 JS 的 OSS 发布包；只有远端验证通过才更新网页引用。它不会创建云资源、修改存储桶权限、读取密钥或自动提交 Git。

目标存储桶：`cancan-portfolio-media`（上海）。已有两个 showreel 视频继续使用原 OSS 地址，不重复上传。

## 准备

在仓库根目录执行，输出必须使用仓库外的新目录：

```sh
python3 tools/prepare_oss.py /tmp/cancan-oss-release
```

工具只收集三个页面实际引用的资源，并递归收集 CSS、SVG 的依赖。输出包含：

- `upload/portfolio/<内容版本>/assets/`：待上传文件，保持完整目录结构。
- `pages/`：准备切换的三个 HTML 页面。
- `manifest.json`：资源清单、文件大小及源文件摘要。

## 上传与验证

1. 使用已授权的 OSS 控制台或官方 ossutil，将 `upload` **里面的内容**上传到存储桶根目录。不要把 `upload` 这一层也上传。
2. 上传资源需允许公开读取，使用正确的 Content-Type。内容版本目录可以设置 `Cache-Control: public, max-age=31536000, immutable`。
3. 为 GitHub Pages 字体加载添加 CORS 规则：允许来源 `https://furinaaa-cancan.github.io`，方法 `GET`、`HEAD`。保留已有其他规则。以后切换到自有域名时，添加对应来源。
4. 上传完成后执行：

```sh
python3 tools/prepare_oss.py /tmp/cancan-oss-release --activate
```

激活会检查源文件是否变化、所有资源的远端状态/大小/类型、字体 CORS，以及已有视频地址。任一检查失败，不修改源页面。全部通过后，才将三个 HTML 页面的资源地址切换至 OSS，并移除重复的本地 showreel 视频来源。

激活后检查本地页面的图片、字体、视频、交互及窄屏布局，再审阅 Git 差异并发布。此流程不删除云端文件，也不改变网站导航地址。

## 整站托管

将资源迁移到 OSS 不会把 `github.io` 页面入口变成阿里云。若连 HTML 也迁移，需确定自有域名，再配置 OSS 静态网站托管、域名和 HTTPS；现有上海地域需要符合域名备案要求。不要直接把默认 OSS 对象地址当作网站入口，它可能触发 HTML 下载。

参考：[阿里云 OSS 静态网站托管](https://help.aliyun.com/zh/oss/user-guide/static-website-hosting/)。

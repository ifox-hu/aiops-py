"""Build Pages from the Python UI; publish only explicitly listed static assets."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "static" / "designs"
OUTPUT = ROOT / "docs"
PAGES = ("workbench-v2", "incident-v2", "knowledge-v2")
ASSETS = ("designs.css", "workbench-v2.css", "incident-v2.css", "knowledge-v2.css",
          "workbench-v2.js", "incident-v2.js", "knowledge-v2.js")
DEMO_LABELS = {
    "正在连接后端": "正在加载演示",
    "后端已连接": "静态演示",
    "后端连接失败": "演示数据加载失败",
    "实际召回": "模拟召回",
    "实际检索": "模拟检索",
    "文档已加入知识库": "演示模式不保存上传文件",
}


def main():
    OUTPUT.mkdir(exist_ok=True)
    for name in ASSETS:
        text = (SOURCE / name).read_text(encoding="utf-8")
        for before, after in DEMO_LABELS.items():
            text = text.replace(before, after)
        (OUTPUT / name).write_text(text, encoding="utf-8", newline="\n")

    for name in PAGES:
        text = (SOURCE / f"{name}.html").read_text(encoding="utf-8")
        for before, after in DEMO_LABELS.items():
            text = text.replace(before, after)
        text = text.replace("</head>", '  <link rel="stylesheet" href="demo.css">\n'
                            '  <script src="mock-api.js"></script>\n</head>')
        (OUTPUT / f"{name}.html").write_text(text, encoding="utf-8", newline="\n")

    (OUTPUT / "LICENSE-JAVA-UI").write_text(
        (ROOT / "LICENSE-JAVA-UI").read_text(encoding="utf-8"),
        encoding="utf-8", newline="\n")
    print("Pages ready: docs/ (three Python UI pages + static mock API)")


if __name__ == "__main__":
    main()

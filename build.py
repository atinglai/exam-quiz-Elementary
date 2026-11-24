#!/usr/bin/env python3
"""把 data/raw/*.json（每份是一年一科的解析結果）合併成網站用的題庫 docs/data/bank.js。

用法：python3 build.py
新增題目：把新的 {年}_{科目}.json 放進 data/raw/ 後，重新執行即可。
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SUBJECTS = ["國文", "公民與英文", "法學大意", "行政學大意"]
OUT = os.path.join(ROOT, "docs", "data", "bank.js")


def load_subject(subject):
    exams = []
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "raw", f"*_{subject}.json"))):
        with open(path, encoding="utf-8") as f:
            exams.append(json.load(f))
    exams.sort(key=lambda e: e["year"])
    return exams


def sec_name(exam, q):
    for s in exam["sections"]:
        if s["id"] == q["section"]:
            return s["name"]
    raise ValueError(f"{exam['year']} {exam['subject']} 第{q['no']}題找不到 section {q['section']}")


def main():
    bank = {}
    for subject in SUBJECTS:
        exams = load_subject(subject)
        if not exams:
            bank[subject] = {"minutes": None, "sections": [], "years": [], "groups": {}, "questions": []}
            print(f"[{subject}] 尚無資料")
            continue

        latest = exams[-1]  # 以最近一年的出題方式為組卷依據
        sections = []
        for s in latest["sections"]:
            sections.append({
                "name": s["name"],
                "type": s["type"],
                "count": s["to"] - s["from"] + 1,
                "pts": s["pointsEach"],
                "note": s.get("scoringNote"),
            })

        questions, groups = [], {}
        for e in exams:
            for q in e["questions"]:
                qid = f"{e['year']}-{q['no']}"
                item = {
                    "id": qid,
                    "y": e["year"],
                    "no": q["no"],
                    "sec": sec_name(e, q),
                    "type": q["type"],
                    "cat": q.get("category"),
                    "s": q["stem"],
                    "o": q["options"],
                    "a": q["answer"],
                }
                if q.get("alts"):
                    item["alt"] = q["alts"]  # 更正答案：其他也給滿分的答案組合
                if q.get("groupId"):
                    gid = f"{e['year']}-{q['groupId']}"
                    item["g"] = gid
                    groups[gid] = q.get("passage") or ""
                questions.append(item)

        # 檢查題庫是否足夠組卷
        for s in sections:
            pool = [q for q in questions if q["sec"] == s["name"] and q["type"] == s["type"]]
            if len(pool) < s["count"]:
                print(f"[警告] {subject}／{s['name']}：題庫 {len(pool)} 題，不足 {s['count']} 題", file=sys.stderr)

        bank[subject] = {
            "minutes": latest["examMinutes"],
            "sections": sections,
            "years": sorted({e["year"] for e in exams}),
            "groups": groups,
            "questions": questions,
        }
        print(f"[{subject}] {len(exams)} 個年度、{len(questions)} 題，考試時間 {latest['examMinutes']} 分鐘")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.BANK = ")
        json.dump(bank, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("已輸出", OUT, f"({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()

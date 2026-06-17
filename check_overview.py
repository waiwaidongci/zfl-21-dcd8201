import json, subprocess

def check(user_id, label):
    print('========== %s ==========' % label)
    result = subprocess.run(
        ['curl', '-s', 'http://127.0.0.1:3021/overview', '-H', 'X-User-Id: ' + user_id],
        capture_output=True, text=True
    )
    data = json.loads(result.stdout)['data']
    ov = data['overview']
    print('原有字段保留:', all(k in ov for k in ['totalClocks','pendingRetest','retestFailed','qualified','neverRetested']))
    print('overview 字段:')
    for k, v in ov.items():
        print('  %s = %s' % (k, v))
    print()
    print('retestTaskPreviews 数量:', len(data['retestTaskPreviews']))
    for t in data['retestTaskPreviews']:
        print('  planned=%s, priority=%s, overdue=%s, note=%s' % (
            t['plannedRetestAt'][:10], t['priority'], t['overdue'], t['note']))
    print()
    print('顶层键:', list(data.keys()))
    print()

check('user_admin_default', '管理员视角')
check('user_tech_zhang', '技师张师傅视角')
check('user_tech_wang', '技师王师傅视角')

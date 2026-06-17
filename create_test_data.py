import subprocess, json, datetime

def curl(method, path, user_id, body=None):
    cmd = ['curl', '-s', '-X', method, 'http://127.0.0.1:3021' + path,
           '-H', 'X-User-Id: ' + user_id]
    if body is not None:
        cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(body)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)

# 创建分配给张师傅的钟表
clock = curl('POST', '/clocks', 'user_admin_default', {
    'code': 'CLK-ZHANG-001',
    'escapementType': '瑞士杠杆式',
    'balanceFrequency': '18000vph',
    'assignedTechnicianId': 'user_tech_zhang',
    'note': '张师傅负责的钟表'
})['data']
clock_id = clock['id']
print('创建钟表:', clock_id, '负责人:', clock['assignedTechnician']['name'])

# 创建调校
adj = curl('POST', '/clocks/' + clock_id + '/adjustments', 'user_admin_default', {
    'currentDailyRateSeconds': 60,
    'direction': '慢针方向',
    'amount': '游丝微调',
    'note': '测试调校'
})['data']
print('创建调校:', adj['id'])

# 逾期高优先级任务
yesterday = (datetime.datetime.utcnow() - datetime.timedelta(days=1)).strftime('%Y-%m-%dT12:00:00.000Z')
task = curl('POST', '/clocks/' + clock_id + '/retest-tasks', 'user_admin_default', {
    'plannedRetestAt': yesterday,
    'priority': 'high',
    'note': '张师傅的逾期高优任务'
})['data']
print('创建复测任务:', task['id'], 'priority=' + task['priority'])

# 今日待复测任务
today = datetime.datetime.utcnow().strftime('%Y-%m-%dT15:00:00.000Z')
task2 = curl('POST', '/clocks/' + clock_id + '/retest-tasks', 'user_admin_default', {
    'plannedRetestAt': today,
    'priority': 'medium',
    'note': '张师傅的今日任务'
})['data']
print('创建复测任务:', task2['id'], 'priority=' + task2['priority'])

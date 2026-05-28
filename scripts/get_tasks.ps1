$langServers = Get-CimInstance Win32_Process -Filter "Name = 'language_server.exe'"
$results = @()

if ($langServers) {
    function Get-ChildProcesses($parentPid) {
        $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $parentPid }
        $res = @()
        foreach ($child in $children) {
            $res += $child
            $res += Get-ChildProcesses $child.ProcessId
        }
        return $res
    }
    
    foreach ($ls in $langServers) {
        $results += Get-ChildProcesses $ls.ProcessId
    }
}

if ($results) {
    $results | Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Json -Compress
} else {
    "[]"
}

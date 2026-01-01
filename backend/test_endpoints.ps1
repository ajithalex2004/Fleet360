$baseUrl = "http://localhost:8080/api"

$endpointsToTest = @(
    @{ List = "/vehicles"; DetailBase = "/vehicles/"; IdField = "id" },
    @{ List = "/drivers"; DetailBase = "/drivers/"; IdField = "id" },
    @{ List = "/maintenance-requests"; DetailBase = "/maintenance-requests/"; IdField = "id" }
)

# Basic list tests
Write-Host "--- Testing List Endpoints ---" -ForegroundColor Cyan
$listEndpoints = @("/vehicles", "/maintenance-requests", "/service-requests", "/drivers", "/garages", "/alert-configs", "/maintenance/predictive")
foreach ($ep in $listEndpoints) {
    try {
        $resp = Invoke-WebRequest -Uri "$baseUrl$ep" -Method Get
        Write-Host "GET $ep - StatusCode: $($resp.StatusCode)" -ForegroundColor Green
    }
    catch {
        Write-Host "GET $ep - FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Detail tests
Write-Host "`n--- Testing Detail Endpoints ---" -ForegroundColor Cyan
foreach ($test in $endpointsToTest) {
    $listUrl = "$baseUrl$($test.List)"
    try {
        $resp = Invoke-WebRequest -Uri $listUrl -Method Get
        # Force array context to handle single item or empty array
        $items = @($resp.Content | ConvertFrom-Json)
        
        if ($items.Count -gt 0) {
            $firstItem = $items[0]
            
            # Try to get ID
            $idVal = $firstItem.($test.IdField)
            if (-not $idVal) { $idVal = $firstItem.id }
            if (-not $idVal) { $idVal = $firstItem.ID }

            if ($idVal) {
                $detailUrl = "$baseUrl$($test.DetailBase)$idVal"
                try {
                    $detailResp = Invoke-WebRequest -Uri $detailUrl -Method Get
                    Write-Host "GET $detailUrl - OK" -ForegroundColor Green
                }
                catch {
                    Write-Host "GET $detailUrl - FAILED: $($_.Exception.Message)" -ForegroundColor Red
                }
            }
            else {
                Write-Host "SKIPPING $($test.DetailBase) - Could not determine ID field. Keys: $($firstItem | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name)" -ForegroundColor Yellow
            }
        }
        else {
            Write-Host "SKIPPING $($test.DetailBase) - List is empty." -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "FAILED to fetch list for $($test.List): $($_.Exception.Message)" -ForegroundColor Red
    }
}

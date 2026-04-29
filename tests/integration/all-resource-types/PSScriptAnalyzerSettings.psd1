# PSScriptAnalyzer settings for integration test scripts
# These scripts are interactive CLI tools where colored console output is intentional

@{
    Severity = @('Error', 'Warning')
    
    ExcludeRules = @(
        # Write-Host is intentional for colored, interactive test output
        'PSAvoidUsingWriteHost'
    )
}

import { Group, Button, Title, Box, ActionIcon } from '@mantine/core';
import { FormattedMessage } from 'react-intl';
import { useConfigStore } from '../context/store';

export default function TSHFields() {
    const app_name = useConfigStore(state => state.name);
    const app_version = useConfigStore(state => state.version);

    return (
        <Box px="md" pt="sm" pb="xs">
            <Title order={4} mb="xs">
                {app_name || 'TSH'} {app_version ? `v${app_version}` : ''}
            </Title>
            <Group gap="xs" grow>
                <Button variant="outline" size="xs">
                    <FormattedMessage
                        id="tsh.set_tournament"
                        defaultMessage="Set Tournament"
                    />
                </Button>
            </Group>
        </Box>
    );
}

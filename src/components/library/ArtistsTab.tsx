import { useNavigation } from '@react-navigation/native';
import { useAtomValue } from 'jotai/utils';
import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import { Image, Text, View } from 'react-native';
import { Artist } from '../../models/music';
import { artistInfoAtomFamily, artistsAtom, artistsUpdatingAtom, useUpdateArtists } from '../../state/music';
import textStyles from '../../styles/text';
import ArtistArt from '../common/ArtistArt';
import GradientFlatList from '../common/GradientFlatList';

const ArtistItem: React.FC<{ item: Artist }> = ({ item }) => {
  const navigation = useNavigation();

  return (
    <Pressable
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 6,
        marginLeft: 6,
      }}
      onPress={() => navigation.navigate('ArtistView', { id: item.id, title: item.name })}
    >
      <ArtistArt id={item.id} width={56} height={56} />
      <Text style={{
        ...textStyles.paragraph,
        marginLeft: 12,
      }}>{item.name}</Text>
    </Pressable>
  );
};

const ArtistItemLoader: React.FC<{ item: Artist }> = (props) => (
  <React.Suspense fallback={<Text>Loading...</Text>}>
    <ArtistItem { ...props } />
  </React.Suspense>
);

const ArtistsList = () => {
  const artists = useAtomValue(artistsAtom);
  const updating = useAtomValue(artistsUpdatingAtom);
  const updateArtists = useUpdateArtists();

  useEffect(() => {
    if (artists.length === 0) {
      updateArtists();
    }
  });

  const renderItem: React.FC<{ item: Artist }> = ({ item }) => (
    <ArtistItemLoader item={item} />
  );

  return (
    <GradientFlatList
      data={artists}
      renderItem={renderItem}
      keyExtractor={item => item.id}
      onRefresh={updateArtists}
      refreshing={updating}
      overScrollMode='never'
    />
  );
}

const ArtistsTab = () => (
  <ArtistsList />
);

export default ArtistsTab;
